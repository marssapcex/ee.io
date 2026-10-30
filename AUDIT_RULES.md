# LUẬT LÀM VIỆC — đọc trước mọi task (bắt buộc)

Người dùng đặt luật này ngày 2026-10-30. Áp dụng cho **mọi** lần audit/tìm bug sau này,
không cần hỏi lại, không cần nhắc lại.

## 1. Chỉ báo bug thoả CẢ BA

1. **Không cần quyền** — khai thác được bởi người lạ chỉ có RPC và tiền gas.
   Không tính: owner/admin/relayer, "nếu owner làm X", key bị lộ, config sai.
2. **Điều kiện khai thác chặt** — kịch bản cụ thể, tái lập được. Không phải "có thể nếu…".
3. **Cướp được tiền** — tiền của người khác bị lấy, hoặc mất không lấy lại được.

## 2. Mọi thứ khác thì im

- Không liệt kê informational/low/style/gas/thiếu test/DoS nhỏ/lộ thông tin.
- Không "ghi nhận cho đủ bộ". Danh sách finding chỉ có thứ đã qua bộ lọc ở mục 1.
- Điều gì đã cố phá mà không phá được thì ghi **1 bảng ngắn** ở cuối (để khỏi thử lại),
  không tính là finding.

## 3. Cách làm

- Đi sâu, không bỏ cuộc, không lười. Hết đường này thì đổi đường khác, nhưng không bịa.
- **Cấm bịa bug, cấm PoC giả.** PoC phải chạy trên code thật, log thật phải dán kèm.
- Không kết luận "an toàn" khi chưa chứng minh được bằng test/log.
- Không đọc pseudo-code hay ảnh chụp rồi đoán; phải có source hoặc bytecode thật.

## 4. Môi trường

- Người dùng cho phép đọc/ghi file, chạy lệnh thoải mái. Máy họ không giữ crypto (ví lạnh).
- Họ nói có thể dùng máy họ qua `arena-bridge`. **Thực tế tool list hiện tại không có
  `arena-bridge`** — kiểm tra lại mỗi session; nếu không có thì nói thẳng, đừng giả vờ.
- Mạng sandbox: chỉ `github.com`, `codeload.github.com`, `api.github.com`,
  `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`. RPC public bị chặn
  (`eth.llamarpc.com` → 000). Muốn chạy PoC thì dựng EVM cục bộ:
  `npm i solc@0.8.24 ganache ethers@6`.
- Chỉ audit code người dùng sở hữu hoặc được uỷ quyền. Không dựng kit khai thác nhắm
  vào protocol của người khác.

## 5. Giọng văn

Đi thẳng vào việc. Không luyên thuyên, không rào đón, không giải thích lại thứ người dùng
đã nói là biết rồi.
