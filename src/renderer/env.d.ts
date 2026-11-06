import type { DolaApi } from '../shared/types';
declare global {
  interface Window {
    dola: DolaApi;
  }
}
