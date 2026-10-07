"""Create a fresh test schema only on the verified workspace-owned daemon."""
import configparser
import os
from sqlalchemy import create_engine, text
from alembic.config import Config
from alembic import command
config=configparser.ConfigParser()
config.read('results/staged-mysql-growth-20261007/auto.cnf')
expected=config['auto']['server-uuid']
assert config['auto']['server-uuid']==expected
engine=create_engine('mysql+pymysql://root@127.0.0.1:34367/?charset=utf8mb4')
name='growth_feedback_20261007_test'
with engine.connect() as connection:
    uuid,port=connection.execute(text('SELECT @@server_uuid,@@port')).one()
    assert uuid==expected and port==34367
    assert connection.scalar(text('SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=:name'),{'name':name})==0,'Refusing to reuse a database'
    connection.execute(text('CREATE DATABASE `growth_feedback_20261007_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'))
engine.dispose()
os.environ['DATABASE_URL']='mysql+pymysql://root@127.0.0.1:34367/'+name+'?charset=utf8mb4'
command.upgrade(Config('backend/alembic.ini'),'head')
print('Verified dedicated test instance; fresh growth schema migrated without changing existing databases.')
