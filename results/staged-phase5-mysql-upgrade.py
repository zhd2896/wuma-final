import configparser, os
from sqlalchemy import create_engine,text
from alembic import command
from alembic.config import Config
c=configparser.ConfigParser();c.read('results/staged-mysql-20261006/auto.cnf')
url='mysql+pymysql://root@127.0.0.1:34365/staged_features_test?charset=utf8mb4'
e=create_engine(url)
with e.connect() as x:
 u,p=x.execute(text('SELECT @@server_uuid,@@port')).one()
 assert u==c['auto']['server-uuid'] and p==34365,(u,p)
 print('Verified dedicated instance',u,p,'schema staged_features_test')
os.environ['DATABASE_URL']=url
command.upgrade(Config('backend/alembic.ini'),'head')
e.dispose()
