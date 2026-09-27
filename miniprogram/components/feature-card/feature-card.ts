import { Feature } from '../../types/domain';
import { openPage } from '../../utils/navigation';
Component({properties:{feature:{type:Object,value:{} as Feature}},methods:{open(){const feature=this.data.feature as Feature;openPage(feature.route);}}});
