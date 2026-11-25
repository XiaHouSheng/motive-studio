/** 应用级常量：GitHub 跳转（顶栏与设置关于页共用） */
export const GITHUB_REPO_URL = "https://github.com/XiaHouSheng/motive-studio";
export const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`;

export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
