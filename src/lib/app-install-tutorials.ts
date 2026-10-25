export type InstallPlatformId = "android" | "ios" | "windows" | "mac";

export type InstallTutorialDef = {
  id: InstallPlatformId;
  title: string;
  buttonLabel: string;
  /** Caminho em `public/` — ex.: coloque o arquivo em `public/videos/tutorials/android.mp4` */
  videoSrc: string;
  /** Opcional: `public/videos/tutorials/android-poster.jpg` */
  posterSrc?: string;
};

/**
 * Vídeos de instalação: adicione os MP4 em `public/videos/tutorials/`
 * com os nomes abaixo (mesmos slugs do `id`).
 */
export const INSTALL_TUTORIALS: readonly InstallTutorialDef[] = [
  {
    id: "android",
    title: "Android",
    buttonLabel: "Como baixar para o Android",
    videoSrc: "/videos/tutorials/android.mp4",
  },
  {
    id: "ios",
    title: "iOS (iPhone / iPad)",
    buttonLabel: "Como baixar para o iOS",
    videoSrc: "/videos/tutorials/iphone.mp4",
  },
  {
    id: "windows",
    title: "Windows",
    buttonLabel: "Como baixar para o Windows",
    videoSrc: "/videos/tutorials/windows.mp4",
  },
  {
    id: "mac",
    title: "Mac",
    buttonLabel: "Como baixar para o Mac",
    videoSrc: "/videos/tutorials/mac.mp4",
  },
] as const;

export const INSTALL_TUTORIALS_UPLOAD_DIR = "public/videos/tutorials";
