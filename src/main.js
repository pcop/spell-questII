import './styles.css';

import { bindStaticEvents, handleKeydown } from './ui/index.js';
import { initGameFlow } from './ui/game-flow.js';

bindStaticEvents();
document.addEventListener('keydown', handleKeydown);
initGameFlow();
