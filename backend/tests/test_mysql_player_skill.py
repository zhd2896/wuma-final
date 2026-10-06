"""Stage four evidence parity using a real isolated MySQL database."""
from fastapi.testclient import TestClient
from backend.app.main import create_app
from backend.app.services.game_store import InMemoryGameStore
from backend.tests.test_mysql_persistence import db, client, pytestmark
from backend.tests.test_player_skill_store import exercise_skill_evidence


def test_mysql_and_memory_same_evidence_same_profile_and_restart(client, db):
    response = client.get('/api/v1/me/profile')
    assert response.status_code == 200 and response.json()['data']['skillProfile']['seal'] == '待'
    sql = client.portal.call(exercise_skill_evidence, client.app.state.store, client.app.state.adapter)
    with TestClient(create_app(store=InMemoryGameStore(), require_auth=False)) as memory:
        expected = memory.portal.call(exercise_skill_evidence, memory.app.state.store, memory.app.state.adapter)
    assert sql == expected
    from backend.app.db.repositories.mysql_store import MySQLGameStore
    from backend.app.db.models import UserModel
    from sqlalchemy import select
    with client.app.state.store.sessions() as session:
        owners = session.scalars(select(UserModel.id)).all()
    restarted = MySQLGameStore(str(db.url))
    try:
        profiles = [client.portal.call(restarted.personal_profile, owner)['skillProfile'] for owner in owners]
        assert sql in profiles
    finally:
        restarted.close()
