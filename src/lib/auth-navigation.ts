import { CAREER_DOCUMENT_DOWNLOAD_PATH } from "@/lib/career-document";

type AuthRouter = {
  push: (href: string) => void;
  refresh: () => void;
};

export function navigateAfterAuthentication(callbackUrl: string, router: AuthRouter) {
  if (callbackUrl === CAREER_DOCUMENT_DOWNLOAD_PATH) {
    window.location.assign(callbackUrl);
    return;
  }

  router.push(callbackUrl);
  router.refresh();
}
