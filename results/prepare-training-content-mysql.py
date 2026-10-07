"""Create fresh isolated databases on the verified workspace test daemon only."""
import configparser
import os
import sys
from sqlalchemy import create_engine, inspect, text
from alembic import command
from alembic.config import Config

config = configparser.ConfigParser()
config.read('results/staged-mysql-20261006/auto.cnf')
expected = config['auto']['server-uuid']
assert expected == '79904ab3-c0d6-11f1-b2bb-088fc3774c8f'
server = create_engine('mysql+pymysql://root@127.0.0.1:34365/?charset=utf8mb4')
names = ('training_content_20261007_test', 'training_content_migration_20261007_test')
if '--migration-retry' in sys.argv:
    names = ('training_content_migration_retry_20261007_test',)
with server.connect() as connection:
    uuid, port = connection.execute(text('SELECT @@server_uuid, @@port')).one()
    assert uuid == expected and port == 34365
    for name in names:
        exists = connection.scalar(text('SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=:name'), {'name':name})
        assert not exists, 'Refusing to reuse an existing database'
        connection.execute(text(f'CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'))
        print('Created fresh test database:', name)
server.dispose()
if len(names) == 1:
    print('Fresh migration retry database left empty; existing databases retained.')
    raise SystemExit(0)
url = f'mysql+pymysql://root@127.0.0.1:34365/{names[0]}?charset=utf8mb4'
engine = create_engine(url)
assert not inspect(engine).get_table_names()
engine.dispose()
os.environ['DATABASE_URL'] = url
command.upgrade(Config('backend/alembic.ini'), 'head')
print('Feature database migrated; second database left empty for migration tests.')
