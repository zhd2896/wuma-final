import { openPage, backHome } from '../../utils/navigation';
Page({
  openRules() { openPage('/guide/pages/rules/rules'); },
  openTutorial() { openPage('/guide/pages/tutorial/tutorial'); },
  openTrial() { openPage('/guide/pages/trial/trial'); },
  openTraining() { openPage('/pages/training/training?source=CURATED'); },
  openCoach() { openPage('/pages/coach/coach'); },
  back() { backHome(); },
});
