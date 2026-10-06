"""Prepare only a fresh test schema on the verified dedicated local MySQL instance."""
import configparser
import re
import sys
from sqlalchemy import create_engine, inspect, text

config = configparser.ConfigParser()
config.read('results/staged-mysql-20261006/auto.cnf')
expected = config['auto']['server-uuid']
name = sys.argv[1] if len(sys.argv) == 2 else 'staged_phase5_20261006_0450_test'
assert re.fullmatch(r'staged_phase5_[a-z0-9_]+_test', name)
engine = create_engine('mysql+pymysql://root@127.0.0.1:34365/?charset=utf8mb4')
with engine.connect() as connection:
    uuid, port = connection.execute(text('SELECT @@server_uuid, @@port')).one()
    assert uuid == expected and port == 34365, (uuid, port)
    assert connection.scalar(text('SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=:name'), {'name': name}) == 0
    connection.execute(text(f'CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'))
    print(f'专用实例已核验: uuid={uuid}, port={port}; 新库={name}')
engine.dispose()
engine = create_engine(f'mysql+pymysql://root@127.0.0.1:34365/{name}?charset=utf8mb4')
with engine.connect() as connection:
    assert inspect(connection).get_table_names() == []
    print('新迁移库为空，未删除任何数据库')
engine.dispose()
