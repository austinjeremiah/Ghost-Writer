#[test_only]
module gusd::gusd_tests;

use gusd::gusd::{Self, Faucet, GUSD};
use sui::coin::Coin;
use sui::test_scenario as ts;

const USER: address = @0xB;

#[test]
fun anyone_can_mint_up_to_cap() {
    let mut s = ts::begin(@0xA);
    gusd::init_for_testing(s.ctx());
    s.next_tx(USER);
    {
        let mut f = s.take_shared<Faucet>();
        gusd::mint_to_sender(&mut f, gusd::max_mint(), s.ctx());
        ts::return_shared(f);
    };
    s.next_tx(USER);
    {
        let c = s.take_from_sender<Coin<GUSD>>();
        assert!(c.value() == gusd::max_mint(), 0);
        s.return_to_sender(c);
    };
    s.end();
}

#[test, expected_failure(abort_code = gusd::EBadAmount)]
fun mint_above_cap_fails() {
    let mut s = ts::begin(@0xA);
    gusd::init_for_testing(s.ctx());
    s.next_tx(USER);
    let mut f = s.take_shared<Faucet>();
    gusd::mint_to_sender(&mut f, gusd::max_mint() + 1, s.ctx());
    ts::return_shared(f);
    s.end();
}

#[test, expected_failure(abort_code = gusd::EBadAmount)]
fun mint_zero_fails() {
    let mut s = ts::begin(@0xA);
    gusd::init_for_testing(s.ctx());
    s.next_tx(USER);
    let mut f = s.take_shared<Faucet>();
    gusd::mint_to_sender(&mut f, 0, s.ctx());
    ts::return_shared(f);
    s.end();
}
