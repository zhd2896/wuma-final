/** End-to-end API check over the configured reverse-proxy URL. */
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const FINISHING_MOVES = [
  ['P01', 'P19'], ['P05', 'P01'], ['P16', 'P18'], ['P01', 'P07'],
  ['P18', 'P13'], ['P07', 'P03'], ['P11', 'P17'], ['P10', 'P07'],
  ['P06', 'P11'], ['P15', 'P14'], ['P17', 'P22'], ['P14', 'P04'],
  ['P19', 'P23'], ['P20', 'P17'],
];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

export async function requestApi(baseUrl, method, route, body) {
  const response = await fetch(new URL(route, baseUrl), {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const payload = await response.json();
  check(response.ok && payload.code === 0 && payload.data,
    `${method} ${route}: HTTP ${response.status}, API ${payload.code}: ${payload.message}`);
  return payload.data;
}

export async function runApiSmoke(baseUrl) {
  const api = (method, route, body) => requestApi(baseUrl, method, route, body);
  const health = await api('GET', '/health');
  const ready = await api('GET', '/ready');
  check(health.engine === 'ok' && ready.engine === 'ok', 'Worker health failed');

  const game = await api('POST', '/api/v1/game', { first_player: 'A', mode: 'LOCAL' });
  check(game.version === 0 && game.state.game_status === 'PLAYING', 'Initial game state invalid');
  const gameRoute = `/api/v1/game/${game.game_id}`;
  const legal = await api('GET', `${gameRoute}/legal-moves`);
  check(legal.moves.length > 0, 'No legal moves in new game');
  const first = legal.moves[0];
  await api('POST', `${gameRoute}/move`, { from_node: first.from, to_node: first.to });
  const persisted = await api('GET', gameRoute);
  check(persisted.version === 1, 'Move was not persisted');
  const analysis = await api('POST', '/api/v1/ai/analyze', {
    game_id: game.game_id, expected_version: 1,
  });
  check(analysis.game_version === 1 && analysis.searchDepth >= 1, 'Analysis failed');

  const coachGame = await api('POST', '/api/v1/game', {
    first_player: 'A', mode: 'AI', ai_player: 'B',
  });
  const hint = await api('POST', `/api/v1/game/${coachGame.game_id}/coach/hint`, {
    level: 1, expected_version: 0,
  });
  check(hint.fallbackUsed && hint.hintText && hint.provider === 'fallback',
    'No-key Coach fallback failed');
  const coachLegal = await api('GET', `/api/v1/game/${coachGame.game_id}/legal-moves`);
  const humanMove = coachLegal.moves[0];
  await api('POST', `/api/v1/game/${coachGame.game_id}/move`, {
    from_node: humanMove.from, to_node: humanMove.to,
  });
  const aiTurn = await api('POST', `/api/v1/game/${coachGame.game_id}/ai-move`, {});
  check(aiTurn.search.searchDepth >= 1 && aiTurn.turn.move, 'AI move failed');

  const finished = await api('POST', '/api/v1/game', { first_player: 'A', mode: 'LOCAL' });
  const finishedRoute = `/api/v1/game/${finished.game_id}`;
  for (const [from_node, to_node] of FINISHING_MOVES) {
    await api('POST', `${finishedRoute}/move`, { from_node, to_node });
  }
  const finalState = await api('GET', finishedRoute);
  check(finalState.version === FINISHING_MOVES.length &&
    finalState.state.game_status === 'FINISHED', 'Review fixture did not finish');
  const review = await api('POST', `${finishedRoute}/review`, {});
  check(review.moveReviews.length > 0 && review.blunders + review.mistakes > 0,
    'Finished-game review missing mistakes');
  const fetchedReview = await api('GET', `${finishedRoute}/review`);
  check(fetchedReview.id === review.id, 'Review did not persist');
  const explained = await api('POST', `${finishedRoute}/review/explain`, {});
  check(explained.review.id === review.id &&
    explained.explanation.gameExplanation.fallbackUsed,
    'No-key review explanation fallback failed');
  const training = await api('POST', `${finishedRoute}/training`, {});
  check(training.total > 0 && training.items.length > 0, 'Training generation empty');
  const listed = await api('GET', '/api/v1/training');
  check(listed.items.some(item => item.id === training.items[0].id), 'Training list missing item');
  const question = await api('GET', `/api/v1/training/${training.items[0].id}`);
  check(!('bestMove' in question), 'Training question leaked answer');
  const trainingLegal = await api('GET', `/api/v1/training/${question.id}/legal-moves`);
  check(trainingLegal.moves.length > 0, 'Training legal moves empty');
  const answerMove = trainingLegal.moves[0];
  const answer = await api('POST', `/api/v1/training/${question.id}/answer`, {
    from_node: answerMove.from, to_node: answerMove.to,
    client_attempt_id: randomUUID(),
  });
  check(answer.trainingId === question.id && answer.legal === true,
    'Training answer failed');

  return {
    status: 'PASS', baseUrl, gameId: game.game_id, gameVersion: persisted.version,
    coachGameId: coachGame.game_id, finishedGameId: finished.game_id,
    reviewId: review.id, trainingId: question.id, trainingAnswer: answer.result,
    noKeyCoachFallback: hint.fallbackUsed,
    noKeyReviewFallback: explained.explanation.gameExplanation.fallbackUsed,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseUrl = process.argv[2] ?? process.env.WUMA_API_BASE_URL ?? 'http://127.0.0.1:8080';
  try {
    console.log(JSON.stringify(await runApiSmoke(baseUrl), null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
