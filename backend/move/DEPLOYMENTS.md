# Deployments

## Sui Testnet (chain id `4c78adac`), 7 Nov 2026

Published with Sui CLI 1.73.1 from the server address
`0xdd6389cc38a64526d84e6189ef8904cf8e83f4721b08f65fe96b8579b46e6f2b`.

| Package / object | ID | Notes |
|---|---|---|
| `enclave` package (Nautilus, vendored in `enclave/`) | `0xc9c14c07c24fc80c1425dcb8f52385d0bb0ff9f671f9dc856a1719c746521802` | Nautilus `move/enclave` at `0104d627` |
| `gusd` package | `0x6dc2c1e1afe9ceece7e2bf64c52055110e5777404d6d23c6d5e51622ec14f2f1` | publish tx `AZ8jvvp755tWTBsTzgMJJbbZU5zfdoV2Xha4snTN9RqK` |
| gUSD coin type | `0x6dc2c1e1afe9ceece7e2bf64c52055110e5777404d6d23c6d5e51622ec14f2f1::gusd::GUSD` | 6 decimals |
| gUSD `Faucet` (shared) | `0x728cea2bd6f17243b575bea09e017407919113aff264389f707bd7b3529501d5` | anyone can mint ≤ 1,000 gUSD per call |
| `ghostwriter` package | `0xff272f596619f255a591323d32d7d0a3835fbdaf84718bdb61f7dec263e23060` | publish tx `9n7WCkP54dMgnQA4KXd8tswznaEsP82Cof4Fpfbyzazi` |
| `AdminCap` (owned by server) | `0x0efa4379f064661d32d5ae86872e423be6a4b9245b2a15b07b6ef6542f6abc0e` | |
| `EnclaveConfig<GHOSTWRITER>` (shared) | `0xea95563f84284e7bfef75a0885ea361c1ccaf8d70005e7e151ed0442333e57f8` | PCRs are placeholders until the enclave is built (P7) |
| `enclave::Cap<GHOSTWRITER>` (owned by server) | `0x125895a0aca256e38cdfe7753136510977bcf238580a96582fe948213b5a0bc6` | needed in P7 to update PCRs |
| `Pool<GUSD>` (shared) | `0x76e3792eeb08a19ad7cb1a72e53472c1f3194726be0aeb8b0ed5ede587051d74` | create tx `5E9pR6X72436kuCnTLAeqTZTgc1FqM3A6ai4ZPnjX5u3`; confirm delay 120 s, max price age 180 s, max conf 2%; funded with 2,000 gUSD |
| Pyth SUI/USD `PriceInfoObject` (Testnet, not ours) | `0x867877562b5d8ac262d93b02062e04b428a2f9bfbb2f05b8af52e04cd98bd241` | pushed by others every ~126 s |

### Why gUSD instead of DUSDC
The backend doc uses DeepBook Predict's DUSDC as the premium/payout coin, but its request form
(`tally.so/r/Xx102L`) is closed. `Pool<C>` is generic over the coin, so Ghostwriter uses its own
test dollar. The optional DeepBook Predict hedge (P10, `HEDGE_ENABLED=false`) still needs DUSDC.

### Rebuild notes
- Manifests use the new Sui package manager: no `[addresses]`, system packages are implicit.
- `ghostwriter` depends on the published `enclave` through `../enclave/Published.toml`, so leave that
  folder as is.
- Tests: `sui move test` in `ghostwriter/` (17) and `gusd/` (3).
