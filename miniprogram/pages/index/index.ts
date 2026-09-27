import { homeService } from '../../services/index';
import { openPage } from '../../utils/navigation';
Page({ data: { features: homeService.getFeatures() }, openHistory() { openPage('/pages/history/history'); } });
