"""Create a fresh migration test schema only on the approved dedicated instance."""
import configparser
import re
import sys
from sqlalchemy import create_engine, inspect, text
config = configparser.ConfigParser()
config.read('results/staged-mysql-20261006/auto.cnf')
expected = config['auto']['server-uuid']
assert expected == '79904ab3-c0d6-11f1-b2bb-088fc3774c8f'
name = sys.argv[1]
assert re.fullmatch(r'staged_phase6_[a-z0-9_]+_test', name)
engine = create_engine('mysql+pymysql://root@127.0.0.1:34365/?charset=utf8mb4')
with engine.connect() as connection:
    uuid, port = connection.execute(text('SELECT @@server_uuid, @@port')).one()
    assert uuid == expected and port == 34365, (uuid, port)
    assert connection.scalar(text('SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=:name'), {'name': name}) == 0
    connection.execute(text(f'CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'))
    print(f'Instance verified: uuid={uuid}, port={port}; fresh migration schema={name}')
engine.dispose()
engine = create_engine(f'mysql+pymysql://root@127.0.0.1:34365/{name}?charset=utf8mb4')
with engine.connect() as connection:
    assert inspect(connection).get_table_names() == []
    print('Migration schema is empty; no database was deleted.')
engine.dispose()
engine = create_engine('mysql+pymysql://root@127.0.0.1:34365/staged_features_test?charset=utf8mb4')
with engine.connect() as connection:
    assert connection.scalar(text('SELECT version_num FROM alembic_version')) == '0017_local_game_imports'
    print('Feature schema verified: staged_features_test, head 0017_local_game_imports.')
engine.dispose()
