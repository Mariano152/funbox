export interface YoutubePlayer {
  cueVideoById(options: { videoId: string; startSeconds: number; endSeconds: number }): void;
  loadVideoById(options: { videoId: string; startSeconds: number; endSeconds: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}

interface YoutubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      width: string;
      height: string;
      host?: string;
      playerVars: Record<string, number | string>;
      events: {
        onReady: () => void;
        onAutoplayBlocked: () => void;
        onStateChange: (event: { data: number }) => void;
        onError: (event: { data: number }) => void;
      };
    },
  ) => YoutubePlayer;
}

declare global {
  interface Window {
    YT?: YoutubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YoutubeApi> | null = null;

export function loadYoutubeApi() {
  if (window.YT) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT as YoutubeApi);
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.appendChild(script);
  });
  return apiPromise;
}
