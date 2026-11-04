def pytest_configure(config):
    # TASK-002 §7 Q18: 실행 시간 측정 테스트 표시
    config.addinivalue_line("markers", "slow: 실행 시간을 재는 테스트 (AC-16)")
