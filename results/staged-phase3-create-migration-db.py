"""仅在已验证的父任务专用 mysqld 上创建唯一空测试库；不删除任何库。"""
import configparser
from datetime import datetime
from pathlib import Path
from sqlalchemy import create_engine, text, inspect

config = configparser.ConfigParser()
config.read(Path('results/staged-mysql-20261006/auto.cnf'), encoding='utf-8')
expected = config['auto']['server-uuid']
name = 'phase3_' + datetime.now().strftime('%Y%m%d_%H%M%S_%f') + '_test'
engine = create_engine('mysql+pymysql://root@127.0.0.1:34365/?charset=utf8mb4')
with engine.connect() as connection:
    identity, port = connection.execute(text('SELECT @@server_uuid, @@port')).one()
    assert identity == expected and port == 34365
    assert not connection.scalar(text('SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=:name'), {'name': name})
    connection.execute(text(f'CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'))
url = f'mysql+pymysql://root@127.0.0.1:34365/{name}?charset=utf8mb4'
empty_engine = create_engine(url)
with empty_engine.connect() as connection:
    assert not inspect(connection).get_table_names()
Path('results/staged-phase3-migration-url.txt').write_text(url, encoding='utf-8')
print(f'专用实例UUID={identity}, port={port}, 新空库={name}, utf8mb4_unicode_ci')
engine.dispose()
empty_engine.dispose()
