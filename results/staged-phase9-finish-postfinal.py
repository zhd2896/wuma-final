"""Read-only verification of this final run's fresh dedicated test schemas."""
import configparser
from sqlalchemy import create_engine, inspect, text

config = configparser.ConfigParser()
config.read('results/staged-mysql-20261006/auto.cnf')
expected = config['auto']['server-uuid']
assert expected == '79904ab3-c0d6-11f1-b2bb-088fc3774c8f'
root = 'mysql+pymysql://root@127.0.0.1:34365/'
for name in ('staged_phase9_finish_full_20261006_test',
             'staged_phase9_finish_empty_20261006_test'):
    engine = create_engine(root + name + '?charset=utf8mb4')
    with engine.connect() as connection:
        identity = connection.execute(text('SELECT @@server_uuid, @@port, DATABASE()')).one()
        assert identity == (expected, 34365, name)
        version = connection.scalar(text('SELECT version_num FROM alembic_version'))
        if name == 'staged_phase9_finish_full_20261006_test':
            assert version == '0019_user_profiles'
            avatar = next(column for column in inspect(connection).get_columns('users')
                          if column['name'] == 'avatar')
            assert avatar['nullable'] is False
            print(f'{name}: verified dedicated UUID/port, migration head0019 and NOT NULL avatar.', flush=True)
        else:
            # The migration test intentionally finishes at 0018 after refusing
            # loss of private REMOTE training owners on downgrade to 0017.
            assert version == '0018_remote_training_owners'
            assert connection.scalar(text('SELECT COUNT(*) FROM training_items WHERE user_id IS NOT NULL')) > 0
            print(f'{name}: verified dedicated UUID/port, expected guarded downgrade at0018 and preserved private owners.', flush=True)
    engine.dispose()
print('Read-only postfinal verification complete; no schemas were deleted.', flush=True)
