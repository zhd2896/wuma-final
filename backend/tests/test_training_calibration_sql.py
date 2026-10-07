"""Execute the repository's window query and compile exact MySQL theme filtering."""
from sqlalchemy import create_engine, text
from sqlalchemy.dialects import mysql
from backend.app.db.repositories.training import TrainingRepository


def test_sql_first_exposure_ignores_retries_other_questions_and_anonymous_rows():
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE training_records (id TEXT, training_item_id TEXT, user_id TEXT, result TEXT, answered_at TEXT)'))
        connection.execute(text('INSERT INTO training_records VALUES (:id, :item, :user, :result, :at)'), [
            dict(id='2', item='q', user='a', result='CORRECT', at='2026-10-07T00:00:02'),
            dict(id='1', item='q', user='a', result='SUBOPTIMAL', at='2026-10-07T00:00:01'),
            dict(id='3', item='q', user='b', result='CORRECT', at='2026-10-07T00:00:01'),
            dict(id='4', item='q', user=None, result='CORRECT', at='2026-10-07T00:00:01'),
            dict(id='5', item='other', user='c', result='CORRECT', at='2026-10-07T00:00:01'),
        ])
        assert TrainingRepository(connection).first_attempt_stats('q') == (2, 1)
        assert TrainingRepository(connection).first_attempt_stats('unknown') == (0, 0)
    sql = str(TrainingRepository.first_attempt_stats_query('q').compile(dialect=mysql.dialect()))
    assert 'row_number() OVER (PARTITION BY training_records.user_id' in sql
    assert 'user_id IS NOT NULL' in sql


def test_mysql_theme_filter_applies_to_count_and_page_with_stage_sorting():
    statements = []
    class EmptyRows:
        def all(self): return []
    class Session:
        def scalar(self, query):
            statements.append(query)
            return 0
        def scalars(self, query):
            statements.append(query)
            return EmptyRows()
    assert TrainingRepository(Session()).list_items(1, 1, None, None,
        source='CURATED', difficulty='EASY', theme='CAPTURE') == ([], 0)
    for query in statements:
        sql = str(query.compile(dialect=mysql.dialect(), compile_kwargs={'literal_binds': True}))
        assert 'json_contains(training_items.training_tags' in sql
        assert "'\"CAPTURE\"'" in sql
        assert "difficulty_tag = 'EASY'" in sql
    page_sql = str(statements[1].compile(dialect=mysql.dialect(), compile_kwargs={'literal_binds': True}))
    assert 'ORDER BY CASE training_items.difficulty_tag' in page_sql
    assert 'LIMIT 1, 1' in page_sql
