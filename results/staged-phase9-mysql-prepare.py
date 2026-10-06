"""Verify the dedicated daemon before creating fresh test-only schemas; never drop a schema."""
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
assert re.fullmatch(r'staged_phase9_[a-z0-9_]+_test', name)
root = 'mysql+pymysql://root@127.0.0.1:34365/'
engine = create_engine(root + '?charset=utf8mb4')
with engine.connect() as connection:
    uuid, port = connection.execute(text('SELECT @@server_uuid, @@port')).one()
    assert uuid == expected and port == 34365
    assert connection.scalar(text('SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=:name'), {'name': name}) == 0
    connection.execute(text(f'CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'))
    print(f'Instance verified: uuid={uuid}, port={port}; created fresh schema={name}', flush=True)
engine.dispose()
engine = create_engine(root + name + '?charset=utf8mb4')
with engine.connect() as connection:
    assert inspect(connection).get_table_names() == []
    print('New migration schema is empty. No schema was deleted.', flush=True)
if len(sys.argv) > 2 and sys.argv[2] == 'profile':
    os.environ['DATABASE_URL'] = root + name + '?charset=utf8mb4'
    cfg = Config('backend/alembic.ini')
    command.upgrade(cfg, '0018_remote_training_owners')
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO users (id, external_user_id, nickname, created_at, updated_at) VALUES "
            "('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'device:old-profile', '旧昵称', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))"))
    command.upgrade(cfg, 'head')
    with engine.begin() as connection:
        assert connection.execute(text('SELECT nickname, avatar FROM users')).one() == ('旧昵称', 'piece_v1_shi')
        connection.execute(text("UPDATE users SET avatar='piece_v1_ma'"))
    try:
        command.downgrade(cfg, '0018_remote_training_owners')
    except RuntimeError as exc:
        assert '拒绝有损降级' in str(exc)
        print('0019 preserves old nicknames/default avatars and refuses lossy custom-avatar downgrade.', flush=True)
    else:
        raise AssertionError('Custom avatar downgrade was accepted')
    with engine.begin() as connection:
        assert connection.scalar(text('SELECT avatar FROM users')) == 'piece_v1_ma'
        connection.execute(text("UPDATE users SET avatar='piece_v1_shi'"))
    command.downgrade(cfg, '0018_remote_training_owners')
    command.upgrade(cfg, 'head')
    print('Default-only downgrade and re-upgrade verified.', flush=True)
if len(sys.argv) > 2 and sys.argv[2] == 'features':
    os.environ['DATABASE_URL'] = root + name + '?charset=utf8mb4'
    command.upgrade(Config('backend/alembic.ini'), 'head')
    print('Fresh stage-nine isolated feature database upgraded to head.', flush=True)
engine.dispose()
if len(sys.argv) <= 2 or sys.argv[2] == 'empty':
    print('Fresh empty schema reserved for the full migration test; not upgraded.', flush=True)
    sys.exit(0)
url = root + name + '?charset=utf8mb4'
engine = create_engine(url)
with engine.connect() as connection:
    assert connection.scalar(text('SELECT version_num FROM alembic_version')) in ('0018_remote_training_owners', '0019_user_profiles')
engine.dispose()
os.environ['DATABASE_URL'] = url
command.upgrade(Config('backend/alembic.ini'), 'head')
engine = create_engine(url)
with engine.connect() as connection:
    assert connection.scalar(text('SELECT version_num FROM alembic_version')) == '0019_user_profiles'
    avatar = next(column for column in inspect(connection).get_columns('users') if column['name'] == 'avatar')
    assert avatar['nullable'] is False
    print('Feature schema at 0019_user_profiles; NOT NULL avatar default verified.', flush=True)
engine.dispose()
