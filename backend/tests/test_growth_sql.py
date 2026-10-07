"""Execute the production SQL evidence query without mocking aggregate results."""
from datetime import datetime, timedelta
import json
from sqlalchemy import create_engine, text
from backend.app.db.repositories.training import TrainingRepository
from backend.app.services.player_growth import calculate_growth

def test_repository_bounds_questions_accounts_and_naive_utc_dates():
    engine=create_engine('sqlite://')
    now=datetime(2026,10,7,12)
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE training_items (id TEXT PRIMARY KEY, training_tags JSON)'))
        connection.execute(text('CREATE TABLE training_records (id TEXT, training_item_id TEXT, user_id TEXT, result TEXT, answered_at DATETIME, hint_level_used INTEGER)'))
        connection.execute(text('INSERT INTO training_items VALUES (:id,:tags)'),dict(id='q',tags=json.dumps(['VULNERABILITY'])))
        rows=[dict(id=id,question='q',user=user,result='CORRECT',at=at,hint=None) for id,user,at in [
            ('one','alice',now),('two','bob',now),('three',None,now),('old','alice',now-timedelta(days=40)),('future','alice',now+timedelta(days=1))]]
        connection.execute(text('INSERT INTO training_records VALUES (:id,:question,:user,:result,:at,:hint)'),rows)
        evidence=TrainingRepository(connection).growth_rows('alice',now-timedelta(days=27),now)
        assert len(evidence)==1 and evidence[0]['id']=='one' and evidence[0]['tags']==['VULNERABILITY']
        growth=calculate_growth(evidence,now)
        assert growth['themes'][1]['remaining']==1 and growth['recent']['current']['completed']==1
        assert TrainingRepository(connection).growth_rows('unknown',now-timedelta(days=27),now)==[]
    engine.dispose()
