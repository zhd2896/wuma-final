"""MySQL persistence for immutable review questions and answer attempts."""

from datetime import timezone

from sqlalchemy import case, func, select, exists, and_, or_
from sqlalchemy.dialects.mysql import insert
from sqlalchemy.orm import Session

from backend.app.core.errors import ApiError
from backend.app.db.models import (GameModel, GameMoveModel, GameReviewModel,
                                   MoveReviewModel, TrainingItemModel, TrainingRecordModel)
from backend.app.schemas.training import (TrainingAnswerResult, TrainingItemInternal,
                                          TrainingSource, TrainingProgress)


class TrainingRepository:
    def __init__(self, session: Session):
        self.session = session

    @staticmethod
    def item_from_row(row: TrainingItemModel) -> TrainingItemInternal:
        return TrainingItemInternal(
            id=row.id, sourceGameId=row.source_game_id,
            sourceKind=row.source_kind, title=row.title, catalogVersion=row.catalog_version,
            difficultyBasis=row.difficulty_basis,
            sourceMoveId=row.source_move_id,
            sourceMoveReviewId=row.source_move_review_id,
            sourceTurn=row.source_turn, player=row.player,
            stateSnapshot=row.state_snapshot, stateSchemaVersion=row.state_schema_version,
            originalMove=row.original_move, bestMove=row.best_move, bestScore=row.best_score,
            sourceCategory=row.source_category, sourceScoreLoss=row.source_score_loss,
            trainingType=row.training_type, trainingTags=row.training_tags,
            difficultyTag=row.difficulty_tag, scoringConfig=row.scoring_config,
            scoringDepth=row.scoring_depth, reviewConfigVersion=row.review_config_version,
            generationVersion=row.generation_version,
            createdAt=row.created_at.replace(tzinfo=timezone.utc),
        )

    @staticmethod
    def record_from_row(row: TrainingRecordModel,
                        item: TrainingItemInternal) -> TrainingAnswerResult:
        return TrainingAnswerResult(
            id=row.id, trainingId=row.training_item_id,
            clientAttemptId=row.client_attempt_id,
            submittedMove=row.submitted_move, legal=row.legal,
            bestMoveEquivalent=row.best_move_equivalent,
            bestMove=item.bestMove, bestScore=row.best_score,
            submittedMoveScore=row.submitted_move_score,
            scoreLoss=row.score_loss, result=row.result, feedback=row.feedback,
            searchDepth=row.search_depth, timedOut=row.timed_out,
            hintLevelUsed=row.hint_level_used,
            answeredAt=row.answered_at.replace(tzinfo=timezone.utc),
        )

    def sources(self, review_id: str) -> list[TrainingSource]:
        rows = self.session.execute(select(MoveReviewModel, GameMoveModel)
            .join(GameMoveModel, GameMoveModel.id == MoveReviewModel.game_move_id)
            .where(MoveReviewModel.game_review_id == review_id)
            .order_by(MoveReviewModel.turn_number)).all()
        return [TrainingSource(sourceMoveId=move.id, sourceMoveReviewId=review.id,
                               stateSnapshot=move.state_before,
                               stateSchemaVersion=move.state_schema_version,
                               originalMove={"from": move.from_node, "to": move.to_node})
                for review, move in rows]

    def commit_items(self, review_id: str,
                     items: list[TrainingItemInternal], user_id: str | None = None, *, remote: bool = False) -> list[TrainingItemInternal]:
        parent = self.session.scalar(select(GameReviewModel).where(
            GameReviewModel.id == review_id).with_for_update())
        if parent is None:
            raise ApiError("REVIEW_REQUIRED", "Generate a game review first")
        game = self.session.get(GameModel, parent.game_id)
        if game is None or game.status != "FINISHED":
            raise ApiError("GAME_NOT_FINISHED", "Training requires a finished game")
        if user_id is not None and not remote:
            if game.mode == 'REMOTE':
                raise ApiError('REMOTE_ACTION_REQUIRED', 'Use the remote room endpoint')
            if game.user_id != user_id:
                raise ApiError('AUTH_FORBIDDEN', 'Game belongs to another account')
        saved = []
        for item in items:
            source = self.session.get(MoveReviewModel, item.sourceMoveReviewId)
            if (source is None or source.game_review_id != review_id or
                source.game_move_id != item.sourceMoveId or
                source.category != item.sourceCategory or
                source.player != item.player):
                raise ApiError("REPLAY_INTEGRITY_ERROR", "Training source relation is inconsistent")
            existing = self.session.scalar(select(TrainingItemModel).where(
                TrainingItemModel.source_move_review_id == item.sourceMoveReviewId,
                TrainingItemModel.training_type == item.trainingType,
                TrainingItemModel.generation_version == item.generationVersion))
            if existing is not None:
                saved.append(self.item_from_row(existing))
                continue
            row = TrainingItemModel(
                id=item.id, source_game_id=item.sourceGameId, user_id=user_id if remote else None,
                source_kind=item.sourceKind, title=item.title, catalog_version=item.catalogVersion,
                difficulty_basis=item.difficultyBasis.model_dump() if item.difficultyBasis else None,
                source_move_id=item.sourceMoveId,
                source_move_review_id=item.sourceMoveReviewId,
                source_turn=item.sourceTurn, player=item.player,
                state_snapshot=item.stateSnapshot.model_dump(mode="json"),
                state_schema_version=item.stateSchemaVersion,
                original_move=item.originalMove.model_dump(mode="json", by_alias=True),
                best_move=item.bestMove.model_dump(mode="json", by_alias=True),
                best_score=item.bestScore, source_category=item.sourceCategory,
                source_score_loss=item.sourceScoreLoss,
                training_type=item.trainingType, training_tags=item.trainingTags,
                difficulty_tag=item.difficultyTag,
                scoring_config=item.scoringConfig.model_dump(mode="json"),
                scoring_depth=item.scoringDepth,
                review_config_version=item.reviewConfigVersion,
                generation_version=item.generationVersion,
                created_at=item.createdAt.replace(tzinfo=None),
            )
            self.session.add(row)
            saved.append(item)
        self.session.flush()
        return saved

    def commit_curated(self, items):
        for item in sorted(items, key=lambda value: value.id):
            values = dict(id=item.id, source_kind=item.sourceKind, title=item.title,
                catalog_version=item.catalogVersion, player=item.player,
                state_snapshot=item.stateSnapshot.model_dump(mode='json'),
                state_schema_version=item.stateSchemaVersion,
                best_move=item.bestMove.model_dump(mode='json', by_alias=True), best_score=item.bestScore,
                training_type=item.trainingType, training_tags=item.trainingTags,
                difficulty_tag=item.difficultyTag, difficulty_basis=item.difficultyBasis.model_dump(),
                scoring_config=item.scoringConfig.model_dump(mode='json'), scoring_depth=item.scoringDepth,
                review_config_version=item.reviewConfigVersion, generation_version=item.generationVersion,
                created_at=item.createdAt.replace(tzinfo=None))
            statement = insert(TrainingItemModel).values(**values)
            self.session.execute(statement.on_duplicate_key_update(id=statement.inserted.id))
            saved = self.get_item(item.id)
            if saved != item:
                raise ApiError('REPLAY_INTEGRITY_ERROR', 'Catalog ID/version contents differ')

    def progress(self, training_id, user_id):
        conditions = (TrainingRecordModel.training_item_id == training_id,
                      TrainingRecordModel.user_id == user_id)
        count, correct = self.session.execute(select(func.count(),
            func.max(case((TrainingRecordModel.result == 'CORRECT', 1), else_=0)))
            .select_from(TrainingRecordModel).where(*conditions)).one()
        latest = self.session.scalar(select(TrainingRecordModel.result).where(*conditions)
            .order_by(TrainingRecordModel.answered_at.desc(), TrainingRecordModel.id.desc()).limit(1))
        return TrainingProgress(attemptCount=count, latestResult=latest, completed=bool(correct))

    @staticmethod
    def first_attempt_stats_query(training_id):
        first = select(TrainingRecordModel.result,
            func.row_number().over(partition_by=TrainingRecordModel.user_id,
                order_by=(TrainingRecordModel.answered_at, TrainingRecordModel.id)).label('attempt_rank'))\
            .where(TrainingRecordModel.training_item_id == training_id,
                TrainingRecordModel.user_id.is_not(None)).subquery()
        return select(func.count(), func.coalesce(func.sum(
            case((first.c.result == 'CORRECT', 1), else_=0)), 0)).where(first.c.attempt_rank == 1)

    def first_attempt_stats(self, training_id):
        count, correct = self.session.execute(self.first_attempt_stats_query(training_id)).one()
        return int(count), int(correct)

    def list_items(self, limit: int, offset: int, category: str | None,
                   training_type: str | None,
                   user_id: str | None = None, source: str = 'REVIEW',
                   difficulty: str | None = None, completed: bool | None = None,
                   source_game_id: str | None = None, player: str | None = None,
                   theme: str | None = None) -> tuple[list[TrainingItemInternal], int]:
        conditions = [TrainingItemModel.source_kind == source]
        if player is not None:
            conditions.append(TrainingItemModel.player == player)
        if category:
            conditions.append(TrainingItemModel.source_category == category)
        if training_type:
            conditions.append(TrainingItemModel.training_type == training_type)
        if difficulty:
            conditions.append(TrainingItemModel.difficulty_tag == difficulty)
        if theme:
            conditions.append(func.json_contains(TrainingItemModel.training_tags, '"' + theme + '"') == 1)
        if source_game_id:
            conditions.append(TrainingItemModel.source_game_id == source_game_id)
        if completed is not None:
            correct = exists(select(TrainingRecordModel.id).where(
                TrainingRecordModel.training_item_id == TrainingItemModel.id,
                TrainingRecordModel.user_id == user_id, TrainingRecordModel.result == 'CORRECT'))
            conditions.append(correct if completed else ~correct)
        if source == 'REVIEW' and user_id is not None:
            conditions.append(or_(and_(GameModel.mode == 'REMOTE', TrainingItemModel.user_id == user_id),
                                  and_(GameModel.mode != 'REMOTE', GameModel.user_id == user_id)))
        base = select(TrainingItemModel)
        count = select(func.count()).select_from(TrainingItemModel)
        if source == 'REVIEW' and user_id is not None:
            base = base.join(GameModel, GameModel.id == TrainingItemModel.source_game_id)
            count = count.join(GameModel, GameModel.id == TrainingItemModel.source_game_id)
        total = self.session.scalar(count.where(*conditions)) or 0
        order = [case((TrainingItemModel.source_category == "BLUNDER", 0), else_=1),
                 TrainingItemModel.created_at.desc(), TrainingItemModel.id.desc()]
        if source == 'CURATED':
            order.insert(0, case({'EASY': 0, 'NORMAL': 1, 'COMPLEX': 2, 'UNCALIBRATED': 3},
                value=TrainingItemModel.difficulty_tag, else_=3))
        rows = self.session.scalars(base.where(*conditions)
            .order_by(*order)
            .offset(offset).limit(limit)).all()
        return [self.item_from_row(row) for row in rows], total

    def get_item(self, training_id: str) -> TrainingItemInternal:
        row = self.session.get(TrainingItemModel, training_id)
        if row is None:
            raise ApiError("TRAINING_NOT_FOUND", "Training question not found")
        return self.item_from_row(row)

    def authorize(self, training_id, user_id):
        parent = self.session.scalar(select(TrainingItemModel).where(
            TrainingItemModel.id == training_id).with_for_update())
        if parent is None:
            raise ApiError('TRAINING_NOT_FOUND', 'Training question not found')
        if user_id is not None and parent.source_kind == 'REVIEW':
            game = self.session.get(GameModel, parent.source_game_id)
            owner = parent.user_id if game.mode == 'REMOTE' else game.user_id
            if owner != user_id:
                raise ApiError('AUTH_FORBIDDEN', 'Training belongs to another account')

    def get_attempt(self, client_attempt_id: str,
                    user_id: str | None = None) -> TrainingAnswerResult | None:
        row = self.session.scalar(select(TrainingRecordModel).where(
            TrainingRecordModel.client_attempt_id == client_attempt_id))
        if row is None:
            return None
        if row.user_id != user_id:
            raise ApiError("TRAINING_ATTEMPT_CONFLICT", "Attempt ID already used")
        return self.record_from_row(row, self.get_item(row.training_item_id))

    def commit_record(self, record: TrainingAnswerResult,
                      user_id: str | None = None) -> TrainingAnswerResult:
        parent = self.session.scalar(select(TrainingItemModel).where(
            TrainingItemModel.id == record.trainingId).with_for_update())
        if parent is None:
            raise ApiError("TRAINING_NOT_FOUND", "Training question not found")
        self.authorize(record.trainingId, user_id)
        existing = self.get_attempt(record.clientAttemptId, user_id)
        if existing is not None:
            if existing.trainingId != record.trainingId or existing.submittedMove != record.submittedMove:
                raise ApiError("TRAINING_ATTEMPT_CONFLICT", "Attempt ID already used")
            return existing
        self.session.add(TrainingRecordModel(
            id=record.id, training_item_id=record.trainingId, user_id=user_id,
            client_attempt_id=record.clientAttemptId,
            submitted_move=record.submittedMove.model_dump(mode="json", by_alias=True),
            legal=record.legal, best_move_equivalent=record.bestMoveEquivalent,
            best_score=record.bestScore,
            submitted_move_score=record.submittedMoveScore,
            score_loss=record.scoreLoss, result=record.result,
            feedback=record.feedback, search_depth=record.searchDepth,
            timed_out=record.timedOut, hint_level_used=record.hintLevelUsed,
            answered_at=record.answeredAt.replace(tzinfo=None),
        ))
        self.session.flush()
        return record
