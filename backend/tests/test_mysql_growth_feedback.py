"""Real MySQL parity and persisted growth after store restart."""
from backend.tests.test_mysql_persistence import db, client, pytestmark
from backend.tests.test_growth_feedback import exercise_real_growth_answers
from backend.app.db.repositories.mysql_store import MySQLGameStore
from backend.app.schemas.account import PersonalProfileDto

def test_mysql_real_answers_account_isolation_and_restart(client,db):
    user,growth=exercise_real_growth_answers(client)
    restarted=MySQLGameStore(str(db.url))
    try:
        profile=client.portal.call(restarted.personal_profile,user)
        PersonalProfileDto.model_validate(profile)
        assert profile['growth']==growth
    finally:
        restarted.close()
