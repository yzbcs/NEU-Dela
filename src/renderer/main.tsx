import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';
import '../shared/theme.css';
import './motion.css';

document.documentElement.dataset.platform = window.dola?.platform ?? 'browser';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
