"""Stop only the verified workspace-owned test daemon after every SQL test exits."""
import configparser
from sqlalchemy import create_engine, text

config = configparser.ConfigParser()
config.read('results/staged-mysql-20261006/auto.cnf')
expected = config['auto']['server-uuid']
assert expected == '79904ab3-c0d6-11f1-b2bb-088fc3774c8f'
engine = create_engine('mysql+pymysql://root@127.0.0.1:34365/?charset=utf8mb4')
connection = engine.connect()
try:
    uuid, port = connection.execute(text('SELECT @@server_uuid, @@port')).one()
    assert uuid == expected and port == 34365
    connection.execute(text('SHUTDOWN'))
    connection.invalidate()
    print(f'Stopped verified test daemon: uuid={uuid}, port={port}; all data directories retained.')
finally:
    connection.close()
    engine.dispose()
