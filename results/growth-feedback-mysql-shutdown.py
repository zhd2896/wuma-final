"""Stop only this task's fresh, verified test instance; retain the data."""
import configparser
from sqlalchemy import create_engine,text
config=configparser.ConfigParser()
config.read('results/staged-mysql-growth-20261007/auto.cnf')
expected=config['auto']['server-uuid']
engine=create_engine('mysql+pymysql://root@127.0.0.1:34367/?charset=utf8mb4')
with engine.connect() as connection:
    uuid,port=connection.execute(text('SELECT @@server_uuid,@@port')).one()
    assert uuid==expected and port==34367
    connection.execute(text('SHUTDOWN'))
    connection.invalidate()
engine.dispose()
print('Stopped verified task-owned test MySQL on port34367; all databases retained.')
