/**
 * Test-only fake ehall upstream used by the browser end-to-end check.
 * It is never imported by the application and never shipped to the browser.
 *
 * Usage:
 *   node tests/fake-ehall-server.js
 *   EHALL_BASE_URL=http://127.0.0.1:8799 EHALL_COOKIE=<session> node server/index.js
 */
import http from "node:http";

const PORT = Number(process.env.FAKE_EHALL_PORT || 8799);

const TEACHER_ROWS = [
  {
    KCM: "计算地球物理基础",
    SKJS: "杨海燕",
    YPSJDD: "3-18周 星期四 3-4节 力行楼4307",
    BQDM: "01",
    BQDM_DISPLAY: "理论课",
    XGXKLBDM: null,
    XGXKLBDM_DISPLAY: "",
    SFXGXK: "0",
    SFXGXK_DISPLAY: "否",
    XXXQDM_DISPLAY: "呈贡校区",
    KKDWDM_DISPLAY: "地球科学学院",
    PKDWDM_DISPLAY: "",
    KCH: "YN253035140015",
    KXH: "01",
    SKBJ: "地球物理2024级",
    XF: 2,
    XS: 36,
    SKXS: 36,
    KNZXS: 2,
    NSXKRS: 30,
    KRL: 60,
    XNXQDM: "2025-2026-2",
    JXBID: "fake-jx-01",
    WID: "fake-wid-01",
    KSJC_DISPLAY: "",
    JSJC_DISPLAY: "",
  },
  {
    KCM: "地震与地震预警",
    SKJS: "杨海燕",
    YPSJDD: "4-18周 星期五 5-6节 格物楼4栋4108,4-9周 星期一 5-6节 格物楼4栋4410,10-18周 星期一 5-6节 格物楼1栋1105",
    BQDM: "02",
    BQDM_DISPLAY: "实验课",
    XGXKLBDM: 33,
    XGXKLBDM_DISPLAY: "自然科学",
    SFXGXK: "1",
    SFXGXK_DISPLAY: "是",
    XXXQDM_DISPLAY: "呈贡校区",
    KKDWDM_DISPLAY: "地球科学学院",
    PKDWDM_DISPLAY: "地球科学学院",
    KCH: "YN253035140016",
    KXH: "02",
    SKBJ: "全校通识",
    XF: 1.5,
    XS: 24,
    SKXS: 18,
    KNZXS: 2,
    NSXKRS: 118,
    KRL: 120,
    XNXQDM: "2025-2026-2",
    JXBID: "fake-jx-02",
  },
  {
    KCM: "非洲文学的历史景象",
    SKJS: "杨海燕,王芳",
    YPSJDD: "4-18周 星期五 5-6节 格物楼4栋4108",
    BQDM: "01",
    BQDM_DISPLAY: "理论课",
    XGXKLBDM: 35,
    XGXKLBDM_DISPLAY: "国际化视野",
    SFXGXK: "1",
    SFXGXK_DISPLAY: "是",
    XXXQDM_DISPLAY: "呈贡校区",
    KKDWDM_DISPLAY: "文学院",
    KCH: "YN253035140017",
    KXH: "01",
    SKBJ: "汉语言文学2023级",
    XF: 2,
    XS: 36,
    SKXS: 36,
    NSXKRS: 56,
    KRL: 60,
    XNXQDM: "2025-2026-2",
    JXBID: "fake-jx-03",
  },
  {
    KCM: "非洲文学的历史景象",
    SKJS: "杨海燕",
    YPSJDD: "4-18周 星期二 3-4节 文汇楼2栋2413",
    BQDM: "01",
    BQDM_DISPLAY: "理论课",
    XGXKLBDM: 35,
    XGXKLBDM_DISPLAY: "国际化视野",
    SFXGXK: "1",
    SFXGXK_DISPLAY: "是",
    XXXQDM_DISPLAY: "呈贡校区",
    KKDWDM_DISPLAY: "文学院",
    KCH: "YN253035140017",
    KXH: "02",
    SKBJ: "汉语言文学2023级",
    XF: 2,
    XS: 36,
    SKXS: 36,
    NSXKRS: 58,
    KRL: 60,
    XNXQDM: "2025-2026-2",
    JXBID: "fake-jx-04",
  },
  {
    KCM: "大学物理（二）",
    SKJS: "杨海燕",
    YPSJDD: "具体安排另行通知",
    BQDM: "01",
    BQDM_DISPLAY: "理论课",
    XGXKLBDM: null,
    XGXKLBDM_DISPLAY: "",
    SFXGXK: "0",
    SFXGXK_DISPLAY: "否",
    XXXQDM_DISPLAY: "东陆校区",
    KKDWDM_DISPLAY: "物理与天文学院",
    KCH: "YN253035140018",
    KXH: "01",
    XF: 3,
    XS: 54,
    SKXS: 54,
    NSXKRS: 88,
    KRL: 100,
    XNXQDM: "2025-2026-2",
    JXBID: "fake-jx-05",
  },
  {
    KCM: "地球科学概论",
    SKJS: "杨海燕",
    YPSJDD: "1-16周 星期三 1-2节 格物楼1栋1105",
    BQDM: "01",
    BQDM_DISPLAY: "理论课",
    XGXKLBDM: "",
    XGXKLBDM_DISPLAY: "",
    XXXQDM_DISPLAY: "呈贡校区",
    KKDWDM_DISPLAY: "地球科学学院",
    KCH: "YN253035140019",
    KXH: "01",
    XF: 2,
    XS: 36,
    SKXS: 36,
    NSXKRS: 40,
    KRL: 80,
    XNXQDM: "2025-2026-2",
    JXBID: "fake-jx-06",
  },
  {
    KCM: "遥感原理与应用",
    SKJS: "杨海燕,赵强",
    YPSJDD: "5-18周 星期四 7-8节 力行楼3201",
    BQDM: "02",
    BQDM_DISPLAY: "实验课",
    XGXKLBDM: 33,
    XGXKLBDM_DISPLAY: "自然科学",
    XXXQDM_DISPLAY: "呈贡校区",
    KKDWDM_DISPLAY: "地球科学学院",
    KCH: "YN253035140020",
    KXH: "01",
    XF: 1,
    XS: 18,
    SKXS: 18,
    NSXKRS: 45,
    KRL: 50,
    XNXQDM: "2025-2026-2",
    JXBID: "fake-jx-07",
  },
  {
    KCM: "地质学基础",
    SKJS: "杨海燕",
    YPSJDD: "3-18周 星期五 1-2节 力行楼2105",
    BQDM_DISPLAY: "理论课",
    XGXKLBDM: null,
    XGXKLBDM_DISPLAY: "",
    XXXQDM_DISPLAY: "东陆校区",
    KKDWDM_DISPLAY: "地球科学学院",
    KCH: "YN253035140021",
    KXH: "01",
    XF: 3,
    XS: 54,
    SKXS: 54,
    NSXKRS: 62,
    KRL: 70,
    XNXQDM: "2025-2026-2",
    JXBID: "fake-jx-08",
  },
  {
    KCM: "空间数据处理",
    SKJS: "杨海燕",
    YPSJDD: "6-18周 星期二 5-6节 力行楼4307",
    BQDM_DISPLAY: "实验课",
    XGXKLBDM: null,
    XGXKLBDM_DISPLAY: "",
    XXXQDM_DISPLAY: "呈贡校区",
    KKDWDM_DISPLAY: "地球科学学院",
    KCH: "YN253035140022",
    KXH: "01",
    XF: 2,
    XS: 36,
    SKXS: 36,
    NSXKRS: 24,
    KRL: 30,
    XNXQDM: "2025-2026-2",
    JXBID: "fake-jx-09",
  },
  {
    KCM: "自然地理学",
    SKJS: "杨海燕",
    YPSJDD: "",
    BQDM_DISPLAY: "",
    XGXKLBDM: 33,
    XGXKLBDM_DISPLAY: "自然科学",
    XXXQDM_DISPLAY: "呈贡校区",
    KKDWDM_DISPLAY: "地球科学学院",
    KCH: "YN253035140023",
    KXH: "01",
    XF: 2,
    XS: 36,
    SKXS: 36,
    NSXKRS: 33,
    KRL: 40,
    XNXQDM: "2025-2026-2",
    JXBID: "fake-jx-10",
  },
  {
    KCM: "地质野外实习",
    SKJS: "杨海燕",
    YPSJDD: "17-18周 星期一 1-4节 校外实习基地",
    BQDM_DISPLAY: "实践课",
    XGXKLBDM: null,
    XGXKLBDM_DISPLAY: "",
    XXXQDM_DISPLAY: "东陆校区",
    KKDWDM_DISPLAY: "地球科学学院",
    KCH: "YN253035140024",
    KXH: "01",
    XF: 2,
    XS: 36,
    SKXS: 36,
    NSXKRS: 20,
    KRL: 20,
    XNXQDM: "2025-2026-2",
    JXBID: "fake-jx-11",
  },
  {
    KCM: "地球化学",
    SKJS: "杨海燕",
    YPSJDD: "2-18周 星期五 3-4节 格物楼2栋2201",
    BQDM_DISPLAY: "理论课",
    XGXKLBDM: 33,
    XGXKLBDM_DISPLAY: "自然科学",
    XXXQDM_DISPLAY: "呈贡校区",
    KKDWDM_DISPLAY: "地球科学学院",
    KCH: "YN253035140025",
    KXH: "01",
    XF: 2,
    XS: 36,
    SKXS: 36,
    NSXKRS: 41,
    KRL: 50,
    XNXQDM: "2025-2026-2",
    JXBID: "fake-jx-12",
  },
];

const COURSE_ROWS = [
  { ...TEACHER_ROWS[2], KCM: "非洲文学的历史景象", KXH: "01", JXBID: "fake-course-01" },
  { ...TEACHER_ROWS[3], KCM: "非洲文学的历史景象", KXH: "02", JXBID: "fake-course-02" },
  {
    ...TEACHER_ROWS[0],
    KCM: "非洲历史与文化",
    SKJS: "王芳",
    XGXKLBDM: 35,
    XGXKLBDM_DISPLAY: "国际化视野",
    KXH: "01",
    JXBID: "fake-course-03",
  },
  {
    ...TEACHER_ROWS[5],
    KCM: "非洲经济研究",
    SKJS: "李明",
    BQDM_DISPLAY: "理论课",
    XGXKLBDM: null,
    XGXKLBDM_DISPLAY: "",
    KXH: "01",
    JXBID: "fake-course-04",
  },
  {
    ...TEACHER_ROWS[8],
    KCM: "中非关系概论",
    SKJS: "张伟,杨海燕",
    BQDM_DISPLAY: "理论课",
    XGXKLBDM: null,
    XGXKLBDM_DISPLAY: "",
    KXH: "01",
    JXBID: "fake-course-05",
  },
];

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

const server = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const form = new URLSearchParams(body);
  let setting = [];
  try {
    setting = JSON.parse(form.get("querySetting") || "[]");
  } catch {
    setting = [];
  }

  const field = setting[0]?.name;
  const keyword = String(setting[0]?.value || "");

  // Lets the browser test cover the session-expired state without a real login.
  if (keyword.includes("过期")) {
    res.writeHead(302, { Location: "https://ids.ynu.edu.cn/authserver/login" });
    res.end("<html><body>302</body></html>");
    return;
  }

  if (keyword.includes("空")) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        datas: { qxfbkccx: { totalSize: 0, pageNumber: 1, pageSize: 10, rows: [] } },
      }),
    );
    return;
  }

  const rows = field === "KCM" ? COURSE_ROWS : TEACHER_ROWS;
  const page = Math.max(1, Number(form.get("pageNumber") || 1));
  const pageSize = Math.max(1, Number(form.get("pageSize") || 10));
  const start = (page - 1) * pageSize;

  setTimeout(() => {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        datas: {
          qxfbkccx: {
            totalSize: rows.length,
            pageNumber: page,
            pageSize,
            rows: rows.slice(start, start + pageSize),
          },
        },
      }),
    );
  }, 40);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`fake ehall upstream listening on http://127.0.0.1:${PORT}`);
});
