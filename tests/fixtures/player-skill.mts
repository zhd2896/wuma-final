export function skill(partial = false) {
  const keys = ['performance', 'best_move', 'decision', 'stability', 'mistake_control', 'training'];
  const labels = ['实战表现', '最佳着率', '决策质量', '稳定性', '失误控制', '训练掌握'];
  return { version: 'player_skill_v1', ready: !partial, overall: partial ? null : 64,
    level: partial ? '待评估' : '熟练', seal: partial ? '待' : '熟',
    metrics: keys.map((key, i) => ({ key, label: labels[i],
      value: partial && i > 0 && i < 5 ? null : [0, 100, 75, 60, 70, 80][i],
      sampleCount: i === 0 || i === 5 ? 5 : 15, minimumSample: i === 0 || i === 5 ? 5 : 15,
      sampleUnit: i === 0 ? '局' : i === 5 ? '次' : '手',
      sampleDetails: i === 0 ? [{ label: 'AI 对局', count: 5, minimum: 5, unit: '局' }]
        : i === 5 ? [{ label: '训练作答', count: 5, minimum: 5, unit: '次' }]
        : [{ label: '复盘局数', count: partial ? 2 : 3, minimum: 3, unit: '局' },
           { label: '复盘着数', count: partial ? 14 : 15, minimum: 15, unit: '手' }],
      description: '真实能力指标' })),
    evidence: { aiFinished: 5, reviewedGames: partial ? 2 : 3, reviewedMoves: partial ? 14 : 15, trainingAttempts: 5 },
    disclaimer: '仅作为弈智五马内的能力参考。' };
}
export function profile(skillProfile = skill()) {
  return { id: 'user1', nickname: '微信棋手', games: 2, finishedGames: 1,
    wins: 1, losses: 0, remoteGames: 0, remoteWins: 0, remoteLosses: 0,
    reviewedGames: 1, training: 2, trainingAttempts: 4, correct: 3, skillProfile };
}
