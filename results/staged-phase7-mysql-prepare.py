"""Upgrade only the approved dedicated instance and create a fresh empty migration schema."""
import configparser
import os
import re
import sys
from sqlalchemy import create_engine, inspect, text
from alembic import command
from alembic.config import Config

config = configparser.ConfigParser()
config.read('results/staged-mysql-20261006/auto.cnf')
expected = config['auto']['server-uuid']
assert expected == '79904ab3-c0d6-11f1-b2bb-088fc3774c8f'
name = sys.argv[1]
assert re.fullmatch(r'staged_phase7_[a-z0-9_]+_test', name)
root = 'mysql+pymysql://root@127.0.0.1:34365/'
engine = create_engine(root + '?charset=utf8mb4')
with engine.connect() as connection:
    uuid, port = connection.execute(text('SELECT @@server_uuid, @@port')).one()
    assert uuid == expected and port == 34365, (uuid, port)
    assert connection.scalar(text('SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=:name'), {'name': name}) == 0
    connection.execute(text(f'CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'))
    print(f'Instance verified: uuid={uuid}, port={port}; fresh migration schema={name}', flush=True)
engine.dispose()
engine = create_engine(root + name + '?charset=utf8mb4')
with engine.connect() as connection:
    assert inspect(connection).get_table_names() == []
    print('New migration schema is empty; no schema was deleted.', flush=True)
engine.dispose()
url = root + 'staged_features_test?charset=utf8mb4'
engine = create_engine(url)
with engine.connect() as connection:
    assert connection.scalar(text('SELECT version_num FROM alembic_version')) in ('0017_local_game_imports', '0018_remote_training_owners')
engine.dispose()
os.environ['DATABASE_URL'] = url
command.upgrade(Config('backend/alembic.ini'), 'head')
engine = create_engine(url)
with engine.connect() as connection:
    assert connection.scalar(text('SELECT version_num FROM alembic_version')) == '0018_remote_training_owners'
    assert 'user_id' in {column['name'] for column in inspect(connection).get_columns('training_items')}
    print('Feature schema upgraded and verified at 0018_remote_training_owners.', flush=True)
engine.dispose()
