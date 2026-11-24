// i18n area: names and sentences that a project profile (profiles/<name>/profile.json "text") may override. Same keys in en and ar.
export const en = {
  "nav.flow": "Work map",
  "nav.branch": "Branch & status",
  "nav.skills": "Skills",
  "who.reviewer": "With {reviewer}",
  "kpi.reviewer.sub": "{ready} ready · {board} board files",
  "ins.board": "{n} PRs conflict only on board files — {reviewer} resolves them inside the batch, we do not rebase",
  "ins.ready": "{n} PRs are green and ready for {reviewer}{behind}. The oldest is #{oldest}, {days} days old",
  "ins.readyBehind": " ({n} of them only BEHIND — they merge as they are)",
  "conflict.boardNote": "There is also a conflict on board files ({files}) — {reviewer} resolves it inside the batch, not shown here.",
  "prs.desc": "Every open PR of the repo, live: where it stands, who it waits for, what failed, what merged.",
  "glossary.desc": "Terms of this project. Add them through the project profile; general terms live in the general glossary.",
};
export const ar = {
  "nav.flow": "خريطة العمل",
  "nav.branch": "الفرع والحالة",
  "nav.skills": "المهارات",
  "who.reviewer": "عند {reviewer}",
  "kpi.reviewer.sub": "{ready} جاهز · {board} ملفات board",
  "ins.board": "{n} PR تعارضها بملفات الـ board فقط — يحلّها {reviewer} داخل الـ batch، لا نعمل rebase",
  "ins.ready": "{n} PR خضرا وجاهزة لـ {reviewer}{behind}. أقدمها #{oldest} من {days} يوم",
  "ins.readyBehind": " ({n} منها BEHIND فقط — بتندمج متل ما هي)",
  "conflict.boardNote": "وكمان تعارض بملفات الـ board ({files}) — يحلّه {reviewer} داخل الـ batch، غير معروض هون.",
  "prs.desc": "كل الـ PRs المفتوحة على الريبو مباشرة: وين واقفة، مين عم تستنى، شو فشل، وشو اندمج.",
  "glossary.desc": "مصطلحات هذا المشروع. أضفها عبر profile المشروع؛ المصطلحات العامة بالمسرد العام.",
};
