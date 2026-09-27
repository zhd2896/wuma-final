import type { GameService, AnalysisService, ReviewService, CoachService, TrainingService, HistoryService, ProfileService, HomeService } from './contracts';
import { boardNodes, boardLines, initialPieces, homeFeatures, recommendationLine } from '../mock/game';
import { analysisDemo } from '../mock/analysis';
import { reviewDemo } from '../mock/review';
import { coachMessages } from '../mock/coach';
import { trainingLevels } from '../mock/training';
import { historyDemo } from '../mock/history';
import { profileDemo } from '../mock/profile';

export const homeService: HomeService = { getFeatures: () => homeFeatures };
export const gameService: GameService = { getBoard: (showRecommendation = false) => ({
  nodes: boardNodes,
  lines: boardLines,
  pieces: initialPieces,
  ...(showRecommendation ? { recommendedFrom: 'P09', recommendedTo: 'P13', recommendLine: recommendationLine } : {})
}) };
export const analysisService: AnalysisService = { getAnalysis: () => analysisDemo };
export const reviewService: ReviewService = { getReview: () => reviewDemo };
export const coachService: CoachService = { getHints: () => coachMessages };
export const trainingService: TrainingService = { getLevels: () => trainingLevels };
export const historyService: HistoryService = { getHistory: () => historyDemo };
export const profileService: ProfileService = { getProfile: () => profileDemo };
