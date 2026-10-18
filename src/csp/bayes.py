import json, numpy as np
np.random.seed(20261018)
# Simple conjugate normal-normal
prior_mean, prior_sd = 0,5
obs = np.array([-4.32,-4.02,-3.88])  # lead 3 methods
sigma = np.array([2.1,2.3,3.0])
# posterior via precision weighted
prec_prior=1/prior_sd**2
prec_obs=1/sigma**2
post_prec=prec_prior+prec_obs.sum()
post_mean=(prior_mean*prec_prior + (obs*prec_obs).sum())/post_prec
post_sd=np.sqrt(1/post_prec)
print(f"post mean {post_mean:.3f} sd {post_sd:.3f}")
with open("UNCERTAINTY/bayes.json","w") as f:
    json.dump({"prior_mean":prior_mean,"prior_sd":prior_sd,"obs":obs.tolist(),"sigma":sigma.tolist(),"post_mean":float(post_mean),"post_sd":float(post_sd),"post_95_low":float(post_mean-1.96*post_sd),"post_95_high":float(post_mean+1.96*post_sd)}, f, indent=2)
