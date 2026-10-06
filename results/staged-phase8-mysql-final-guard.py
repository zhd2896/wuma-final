"""Read-only identity and empty-schema guard before final full suite."""
from sqlalchemy import create_engine, inspect, text

root = 'mysql+pymysql://root@127.0.0.1:34365/'
for schema in ('staged_features_test', 'staged_phase8_20261006_final_test'):
    engine = create_engine(root + schema + '?charset=utf8mb4')
    with engine.connect() as connection:
        identity = connection.execute(text('SELECT @@server_uuid, @@port')).one()
        assert identity == ('79904ab3-c0d6-11f1-b2bb-088fc3774c8f', 34365), identity
        assert connection.scalar(text('SELECT DATABASE()')) == schema
        if schema == 'staged_features_test':
            assert connection.scalar(text('SELECT version_num FROM alembic_version')) == '0018_remote_training_owners'
        else:
            assert inspect(connection).get_table_names() == []
            assert connection.scalar(text('SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=DATABASE()')) == 'utf8mb4_unicode_ci'
        print(f'Final guard verified {schema}: UUID/port and head or empty utf8mb4_unicode_ci schema.', flush=True)
    engine.dispose()
