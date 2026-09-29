import type { AnalysisData, BoardState, CoachMessage, Feature, ReviewData, TrainingLevel } from '../types/domain';
export interface HomeService { getFeatures(): Feature[] }
export interface GameService { getBoard(showRecommendation?: boolean): BoardState }
export interface AnalysisService { getAnalysis(): AnalysisData }
export interface ReviewService { getReview(id?: string): ReviewData }
export interface CoachService { getHints(): CoachMessage[] }
export interface TrainingService { getLevels(): TrainingLevel[] }
