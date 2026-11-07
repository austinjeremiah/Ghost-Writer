#[test_only]
module ghostwriter::ghostwriter_tests;

use ghostwriter::ghostwriter;

#[test]
fun scale_matches_e8() {
    assert!(ghostwriter::scale_to_e8(68005477, 8) == 68005477, 0);
    assert!(ghostwriter::scale_to_e8(6800, 4) == 68000000, 1);
    assert!(ghostwriter::scale_to_e8(6800547700, 10) == 68005477, 2);
}

#[test]
fun test_name() {
    assert!(ghostwriter::name_for_testing() == b"ghostwriter".to_string(), 0);
}
