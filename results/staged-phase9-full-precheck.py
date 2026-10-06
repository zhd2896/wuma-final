"""Read-only verification of the exact dedicated databases before the final full suite."""
import configparser
from sqlalchemy import create_engine, inspect, text

config = configparser.ConfigParser()
config.read('results/staged-mysql-20261006/auto.cnf')
expected = config['auto']['server-uuid']
assert expected == '79904ab3-c0d6-11f1-b2bb-088fc3774c8f'
root = 'mysql+pymysql://root@127.0.0.1:34365/'
for name in ('staged_phase9_features_full_test', 'staged_phase9_full_migration_test'):
    engine = create_engine(root + name + '?charset=utf8mb4')
    with engine.connect() as connection:
        uuid, port, connected = connection.execute(text('SELECT @@server_uuid, @@port, DATABASE()')).one()
        assert (uuid, port, connected) == (expected, 34365, name)
        if name == 'staged_phase9_features_full_test':
            assert connection.scalar(text('SELECT version_num FROM alembic_version')) == '0019_user_profiles'
            assert connection.scalar(text('SELECT COUNT(*) FROM users')) == 0
            print(f'{name}: correct daemon UUID/port, fresh feature schema head0019 and zero users.', flush=True)
        else:
            assert inspect(connection).get_table_names() == []
            collation = connection.scalar(text('SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=DATABASE()'))
            assert collation == 'utf8mb4_unicode_ci'
            print(f'{name}: correct daemon UUID/port, still empty, utf8mb4_unicode_ci.', flush=True)
    engine.dispose()
