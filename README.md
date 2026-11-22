# 只有我们俩 · 网页版

这是一个可以直接用 GitHub Pages 托管的静态网页。清单和下次见面的日期保存在一个独立的 GitHub 私有仓库里。网页打开时读取最新内容，切回页面时也会刷新，打开页面期间每 45 秒检查一次更新。

## 使用前预览

用浏览器打开 `index.html` 可以试用本机预览。添加、编辑和删除的数据保存在当前浏览器。连接 GitHub 后，页面显示私有仓库里的清单，本机预览的数据可以在断开连接后继续查看。

## 发布网页并连接清单

1. 在 GitHub 上建一个**公开的网页仓库**，把本目录里的文件上传到仓库根目录。打开仓库的 **Settings → Pages**，选 **Deploy from a branch → main → / (root)**，保存。部署后使用这里显示的 Pages 网址。 [GitHub Pages 发布指引](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
2. 另建一个专门保存清单的**私有仓库**。创建时选 **Add a README file**，让默认分支有第一笔提交。网页第一次保存清单时会自动创建 `meeting-list.json`。
3. 用私有仓库所有者账号创建两个 [细粒度访问令牌](https://github.com/settings/personal-access-tokens/new)，每台设备用一个。在 **Repository access** 选 **Only select repositories**，只勾选私有数据仓库。在 **Repository permissions** 给 **Contents → Read and write**，并为令牌设有效期。两枚令牌可以分别撤销。令牌有数据仓库的读写权限，请只输入到你们部署的网页里。 [令牌设置说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
4. 两台设备打开同一个 Pages 网址，点 **连接 GitHub**，填同一个 `用户名/私有仓库名` 和各自的令牌。自己的设备可以勾选「在自己的设备上记住连接」，之后打开页面会直接加载。取消勾选时，连接保留在当前浏览器标签页的会话中。
5. 一台设备添加一条内容，另一台设备点 **刷新清单**，就能验证同步。双方同时修改不同条目时会合并。若另一方已改了同一条内容，页面会提示刷新后重新操作。

## 清单数据

网页仓库只放网页文件。清单内容和令牌请各自存放在私有仓库和各自的浏览器中。每次写入会在私有仓库留下提交记录，删除条目只会把它从当前清单移除，仓库历史仍可查看。两台手机都需要能访问 GitHub Pages 和 GitHub API。
