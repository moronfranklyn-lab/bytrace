---
title: "实测Vibe Motion新概念：10个我踩过的坑"
date: 2026-06-26
tags: [Vibe Motion, AI视频, Remotion, HyperFrames, Claude Code, Codex]
platform: 人人都是产品经理 / 公众号 / 少数派 / 优设 / 抖音
status: 待发布
---
最近又出了一个新概念，叫 **Vibe Motion**。

  

一开始是有点无感的。自从卡帕西定义了 **Vibe Coding** 以后，圈子里基本什么都往 vibe 上套。Vibe Writing、Vibe Design、Vibe Marketing... 感觉只要跟 AI 沾边的，前面都能挂个 vibe。

  

而且我第一反应是，这大概是用 Seedance、可灵这类视频生成模型做视频的方法论。AIGC 直接生成视频嘛，往 vibe 上包装一下也正常。但作为一个 AI 极客，新概念出来了肯定还是会去研究的。

调研了一圈才发现，完全不是我想的那样。

**Vibe Motion 不是用 AI 直接生成视频，而是用代码来驱动动画和视频的生成。**

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=NzFjN2Y5MDVjNjc5OGQ4ZWYxYmIwMDA5OTQ0ZmRlMWRfdUJRaTR5TXJNZmc3RWVmSTBtQlFSRkswM1h4Uk16c1FfVG9rZW46UDB5SWJ5cEltb3ZWelZ4Q0ZtOGMyT211bk1iXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

目前这个方向最火的两个开源框架是 **Remotion** 和 **HyperFrames**。有意思的是，这两个框架其实比 AI 编程热潮还要早。Remotion 2021 年就有了，HyperFrames 是 2026 年 4 月才开源的新玩家，但底层思路一脉相承。

  

底层逻辑其实不复杂：**它们都是把网页代码逐帧截图，然后拼成视频。** 区别在于写法。Remotion 用 React 组件来描述视频的每一帧，你写的是 JSX 和 CSS；HyperFrames 用原生 HTML + CSS + GSAP 动画，写的就是网页。最终都通过无头浏览器逐帧捕获，再用 FFmpeg 编码成 MP4。

  

两者的优势和短板也很明显：

**Remotion** 的强项是组件化和复用。你做过一个动效模版，下次同风格的视频直接 import 进来改参数就行。而且因为是 React，能做参数化批量生成，数据驱动出 100 条不同内容的视频都没问题。**短板是，它对真人实拍素材的混编不太友好。** 你要把一段真人口播和代码画面揉在一起，会很别扭。

**HyperFrames** 的强项是对 AI Agent 极度友好。因为写的是 HTML，而大模型写 HTML 的能力天生就很强，Agent 改个文件、调个样式、抽帧检查都很顺畅。加上完全免费（Apache 2.0），没有按人头或渲染次数收费的门槛。**短板是太新了。** 2026 年 4 月才开源，生态、文档、社区沉淀都不如 Remotion 成熟，踩坑的概率更高。

这些优劣势后面在具体案例里会反复体现，这里先有个印象就行。

## 往深想一层：AI 正在逐步覆盖我们的感官

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=MGVlOGFlNjQ2Njc5ZGE3ODVkNDc1NzI2YjExMWM2NWJfUFdPeERkT3pOMUZOMXEwUk1FdW4yOGFJblJWZGptTFRfVG9rZW46SUduRmJrdEx1bzMwcFB4TjR3amM1aXhSblhnXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

  

但说坑之前，你有没有发现，从 Vibe Coding 到 Vibe Writing、Vibe Design，再到现在的 Vibe Motion，有些事悄然发生了变化。

  

AI 最早搞定的是**代码**。代码的验收标准很客观，能跑就行，不能跑就是 bug，AI 很容易得到明确的反馈去迭代。

  

然后是**文字**。早期 AI 写东西一股子机器味，但随着模型能力增强，拟人感越来越强，人们开始接受用 AI 来写文章、写书、甚至写论文。

  

接着是**设计**。这一步难度跳了一个台阶，因为审美是主观的，AI 不光要理解语义，还要理解人觉得什么好看。

  

现在轮到了**动态视觉**。视频比静态设计又多了一个维度：**时序**。不光要好看，还要在对的时间出现对的东西，节奏感、信息密度、画面编排全都要对。

  

但这个路径：语义理解-逻辑执行-审美判断-时序编排。每往前走一步，AI 需要理解的东西都在叠加。

  

但这不只是AI 变强了这么简单。

  

**它其实是在往人类理解世界的方式上靠拢。** 我们人感知信息就是这个顺序，先读文字，再看逻辑，再感受美不美，再体验节奏和动态。AI 正在沿着这条线，逐步覆盖我们的不同感官通道。

  

这是一件值得认真想想的事。

  

而且这件事正在加速。就在我写这篇文章的时候，Figma 刚在 Config2026 上发布了几个功能，有一个就是 **Figma Motion**，把动画时间线直接内置进了设计画布，还支持 MCP 协议，动画帧可以直接传给 AI 编码 Agent 去实现。连设计工具的巨头都开始把 Motion 当一等公民了。这个方向，确实有的搞的。

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=ZWI0MGQwMmIxNDE3NDY2ZjUzYjQwOWEwMTkyNzJkNTJfS2gzV0xVM3dRalpFa3FFN0RpRXJmYmpyVnhzZzk5ajFfVG9rZW46Vmx1cWJaZVZBb1ZrRUJ4cTJKN2NCUThwbk1jXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

## 但 Vibe Motion 不是你想的那样

  

聊完大趋势，回到 Vibe Motion 本身。

  

很多人看到这个概念的第一反应是：**AI 是不是能一句话帮我生成一条视频了？**

  

不是。至少现阶段不是。

  

我实测了两周，最大的感受是：Vibe Motion 更像是**把视频制作变成了一套工程流程**。可调试、可验证、可复用。

  

以前剪视频，哪里不对靠感觉改。代码做视频，哪里不对你能定位到具体的时间码、图层和坐标。这是本质区别。

  

所以这篇文章不是概念科普，是我实测下来，大概踩了 10 个坑以后的一次复盘。从最早的实验验证，到想做成可重复产出架构时一路踩坑，再到最后沉淀出一套选型框架。

## 测试验证：CC + Remotion

  

了解完概念之后，我第一个上手测的组合是 **Claude Code + Remotion**。

  

原因很简单。我当时的需求是做一些 AI 产品概念的解释视频，纯动画，不需要真人出镜。Remotion 是 React 写视频，我平时用 Claude Code 写代码已经很顺了，这俩接在一起是最自然的选择。

  

最早拿来练手的是 **PE 系列**（Prompt Engineering 概念解释视频）。第一条视频做出来的感受就是：**能出片，但很糙。**

  

画面有了，但动效很死板，就是文字一行一行弹出来，背景换个颜色，偶尔来个淡入淡出。没有音效，没有节奏感，更谈不上什么视觉冲击力。说是视频，其实更像一个会动的 PPT。

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=M2Y1NjViMDQ2N2I1YzI3Mzk4ZDZlYTY1MDI3ODRmYThfd0JJdmhHZjZPSHJieE5HOUVkNFpoSDNnMlQwZHVwamVfVG9rZW46VEh1ZWIxdUtub3VGYU54S3hpZmNXVjI0bkRlXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

但至少验证了一件事：**用代码做视频这条路，确实跑得通。**

  

接下来就是多轮的调整和迭代。根据发到抖音后的流量反馈，加上自己反复看片的感觉，每条视频都在前一条的基础上改进。画面越来越丰富，动效开始有层次，整体完成度在肉眼可见地提升。

  

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=MjNiYTBmYzJlZDVkY2Y4MWNiN2ZmOWFlMTFmNDZhZGNfM2VFZG0waGFkb3ZyNlNEYkJKa3pORWRjMFVqckNRSWlfVG9rZW46WDJubWJ4M2pWb25oV0p4NndWcWNHdE9FbnplXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=YTE2ODhhNzg5MjBlMmVmOTU3YjhlZGFlNTFjN2E3ZWZfQmVzQ0FGUHU4NG4zaFgydVFDSmNRSllQam9UYzdQeWdfVG9rZW46REdXWWJDTVp6b3Ayend4N0VJOWNBNFJnbmhnXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

  

PE 系列验证了代码做视频跑得通以后，我开始想一个问题：**怎么把这套流程做成可重复产出的架构？** 不能每次都从头来一遍，得有一套系统化的生产流程。

  

从这里开始，坑就来了。

  

---

  

## 坑 1：想用 Multi-Agent 提效，跑了一晚上没出来

  

Claude Code 有一个 subagents 的能力，可以拆分任务让多个子 Agent 并行跑。我当时的想法是：一个 Agent 负责写脚本，一个负责做分镜，一个负责写动效代码，最后汇总渲染。听起来很合理对吧？

  

**结果是灾难级的。**

  

生成速度反而变慢了，因为多个 Agent 之间的上下文不共享，A 写的脚本 B 看不到，B 做的分镜 C 不知道，最后汇总出来的东西牛头不对马嘴。跑了整整一个晚上，什么都没出来。

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=MzI4YTY2M2Y1MzU5Y2UxZGY3YjMxNWY3YTAwNzU4YmRfSTczNVJyc0N3NW82MWFscWtEU0J5UlVyQ0NHZ1pST0VfVG9rZW46VVhaNmIyVlV5b0pxOTd4a0Q2a2NVTUoyblViXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

> 教训很清楚：并不是架构越复杂越好。对于视频生产这种高度依赖上下文连贯性的任务，单 Agent + 清晰的文档结构，比多 Agent 并行要稳得多。

  

最后回退到了一个更朴素的方案：**DESIGN.md + CLAUDE.md + 多个 SKILL 文件**的架构。一个 Agent 从头到尾跟完整条视频，但通过文档来给它清晰的上下文边界和规范约束。

  

这套架构后来一直沿用到现在。

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=ZmEyYWZkZDljMzA5YzgyMDM3ZjcyZjI1NWJmZThmYjFfREpoU0hXang5RTJxb0NvUVFjSU0zdFlPZWNZaFpQdTlfVG9rZW46QmVtQWJXQWY1b3BZMlR4RXl5NWN4VW9CbjZmXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

## 坑 2：跳过 DESIGN 直接写代码，整片风格乱飞

  

Multi-Agent 的坑踩完以后，我开始认真打磨单条视频的质量。

  

但又踩了第二个坑：**着急写代码，没有先锁视觉系统。**

  

表现就是，每个镜头单看还行，但放到一起整片的风格完全不统一。这个镜头用了蓝色背景，下个镜头突然变成黑色。这段用了一种字体，下一段又换了一种。动效有的是弹入，有的是淡入，有的是直接出现。看完整条视频的感觉就是：**每一帧都在告诉你，这是不同的人做的。**

  

后来我才明白一个道理：**做视频和做产品一样，先有 Design System，再有代码。**

  

我开始在每个视频项目里先建一个 **DESIGN.md**，进去之前先把色板、字体、容器样式、动效规范、转场方式全部锁死。Agent 写代码的时候严格按照 DESIGN.md 来，不允许自由发挥。

  

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=ZmRiMWU3YjRiNmNiN2ZjMmExMWI1NjE3NGQ3MDlkZjBfTDEzQWR1YkN3M3VmdzZSQnZyZEhpTGMxVXdzS0xWSVRfVG9rZW46VWtocGJHSkVCb3BqUWd4Zlg3a2NSRzNPbkRMXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

  

效果立竿见影。整片的统一感一下子就上来了。

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=NDA4ZDMyYjllMDJhNjg3ZjRjM2VlMmRiMTUxYjcwNzlfdFRlWThrTjhYMngwbWducWlKaGZ6OWNUd0RaYkhvdVFfVG9rZW46QWZ2RmJwYXpib0pJZ3B4WDBETWN4dUhBbjFnXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

## 升级验证：Loop Engineer，全合成动画的上限

  

经过前面的踩坑和迭代，到 **Loop Engineer** 这条视频的时候，整套流程已经比较成熟了。

  

Loop Engineer 是一条讲技术概念的视频。我选了一个 **终端赛博风** 的视觉方向：GitHub Dark 配色、等宽字体、macOS 终端窗口、CRT 扫描线、故障字效果。全片靠代码绘制，零外部素材。

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=YjA5YzA4YmE0NmU4OTljZDAwZDIwOGJhYmY0MmE5MWJfajdJdHRKTVE2QVdROUVvbGVsRDZTM0pTQkhHSXZ2T3FfVG9rZW46SjNRSGJsUGplb1dkSXB4M2psdmNyQjlSbjNjXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

  

这条视频验证了 Claude Code + Remotion 这套组合的上限：

  

**首先是素材流程跑通了。** 我在自己的素材库里囤了大概 300 条动效参考。做 Loop Engineer 的时候，五种文字效果和两款赛博背景全部命中了素材库。但这些源码不能直接拿来用，需要做一遍移植，改成视频引擎能用的格式。

  

**其次是复用机制建立了。** 这条视频做完以后，五个移植好的动效模版被沉淀进了一个公共的模版库里。下一条同风格的视频直接导入，改参数就行。做一条片等于产一批可复用的资产，越做越快。

  

**第三是整体工作流稳定了。** 从口播稿到 DESIGN、分镜、代码合成、远程渲染、带字幕交付，整条链路跑得很顺。

  

做完 Loop Engineer，我觉得全合成动画这条路已经走通了。流程稳定，效果能打，资产能复用。

  

然后我就犯了一个经典错误：**觉得既然全合成能跑，口播应该也差不多吧。**

  

---

  

## 坑 3：全合成套路直接套口播，完全跑不通

  

做内容的人都知道，纯动画视频可以发，但口播才是日常产出的主力。大部分时候就是你真人拍一段，然后在画面上叠加图文、资料卡、截图、录屏这些辅助信息。

  

所以我想，反正流程都跑通了，换个输入不就行了？

  

**结果是，之前积累的所有经验几乎全部失效。**

  

全合成视频的逻辑是：从零生成一切，所有画面都是代码画出来的，AI 有完全的控制权。口播视频完全不一样，你有一条真人实拍的素材，画面、声音、节奏都已经定了，AI 要做的是围绕这条已有的时间轴去搭建图文层。

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=NjQ4MzcyMzM1NDc4ZTQwYWJmNGQ1MzU5YzdkMDJiMzlfYjFtamNGQVlVdHF3aG1DQzcwSWlRQXBBZU9wWjVpaDFfVG9rZW46Q0NYaWJ0MzR0b1pLRzZ4M09JQ2M1OGNsbmFkXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

这两种模式的底层逻辑完全不同。

## 坑 4：Claude Code + HyperFrames 做口播，对不齐、模块乱飞

  

既然全合成的组合做口播不行，我就换引擎试试。

  

HyperFrames 用的是 HTML，做图文叠加应该更灵活。加上 Claude Code 我已经用得很顺了，这个组合听起来没毛病。

  

**结果是另一种灾难。**

  

口播和画面的时间对不齐，嘴上说到 A 点了，画面上还停在 B 点。模块飞来飞去，字幕和标题互相压，PIP 小窗和资料卡抢位置。整个画面像是几个人各做各的然后硬拼到一起。

  

核心问题是，Claude Code 虽然写代码很强，但它处理真人口播视频这种高度依赖精确时间码的任务时，对齐能力不够。

  

---

  

## 坑 5：砸钱试 Codex + Remotion，还是不行

  

两个组合都翻车了。我开始想，是不是应该换 Agent 试试。

  

Codex 是 OpenAI 的编码 Agent，能力也很强。Remotion 我已经很熟了。这个组合应该能行吧？

  

**花了钱，结果还是不行。**

  

Remotion 的 React 组件化在全合成场景下是优势，但在口播重剪场景下反而变成了负担。你要把一段真人实拍的视频塞进 React 的帧驱动渲染管线里，光是让视频正常播放就要费很大力气，更别说在上面灵活叠加图文了。

  

到这里，四种组合我已经系统性地逐一验证了三种，全灭。

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=NmZhOWVkYTRmZmFkMGNkYjZiNWU0YmMwZWFmZWFmNDRfSGo3V3dCbU40R0t0c1NzOTNiNENRN0tEUk12MzVEeFJfVG9rZW46SE9aY2JsQVF5b2pHSWd4RFlFZWN5bjl5blFmXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

还剩最后一个组合。从排除法的角度看，如果 Remotion 做口播不行（不管搭配谁），Claude Code 做口播也不行（不管搭配谁），那问题就很清楚了：**口播场景需要的是 Codex 的执行能力 + HyperFrames 的 HTML 灵活性。** 这不是碰运气，是四条路径逐一验证后剩下的唯一选项。

  

---

  

## 破局：Codex + HyperFrames，口播跑通了

  

最后一个组合验证下来，确实跑通了。

  

回过头看逻辑也说得通：HyperFrames 写的是 HTML，而口播视频的本质就是**在一条真人视频上面叠透明的图文层**。HTML 天生就是做这件事的。资料卡、截图、字幕、PIP 小窗、红框标注，这些东西用 HTML/CSS 来写，比用 React 组件去强行包装要自然得多。

  

而 Codex 在处理这类改文件、调样式、逐帧检查的任务时，和 HyperFrames 的配合非常顺畅。它能直接读 HTML、改 CSS、跑渲染、抽帧检查，整个循环转得很快。

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=OWQ3ZDQwNTU0YTljOGI2YzhjMjgzNjdjNmI5NjYxNmFfTGdrMnh4YTZPZEl0QTdPeWZ4bXU4QktBQk9JbGVKNW5fVG9rZW46TUN1a2J4SzJqb1dCbnN4a3VscGN1UzNjbndjXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

但跑通不等于一帆风顺。接下来做《创始人手册》这条口播视频的时候，又踩了五个制作层面的坑。

  

## 《创始人手册》：口播制作实战 + 坑 6-10

  

《创始人手册》是一条约 3 分钟的真人口播视频。内容从 Humane AI Pin 的失败开场，引出 Anthropic 的创业手册，再转到我自己做 Lollipop 的创业经历，最后落到一个思考：**AI 时代做东西变快了，但想东西没有变快。**

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=OGE3MzRkNTE3YTY1N2FlZDUxYjFiNWZhODE1ODMwNmVfc2FLRnhMb1FFOURteXJNNnFsRnV5b0E3TFBzNVpZaVJfVG9rZW46TEtUeWJzYmZMb3NRVmN4allRMmNiaWJUbjZiXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

  

整条视频迭代了五个版本。每一版我都完整看一遍，按时间码标出所有问题，交给 Codex 去修。最夸张的一次，我一口气给了 21 个具体问题。

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=MDY2OTc2MWIzNTJjYWZlODI5MTg2MDJlM2ZhYWE2NmVfRGhjd0tkdkd3YVJVRzZLWEZrZ2xqS2RQZ2V5dFdrOGdfVG9rZW46UWZLbWJ0aVhYb3RxeHV4ZGdGWWNZcGdjblFnXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

  

这个过程里踩的五个坑，是代码做口播视频最核心的经验。

  

### 坑 6：预览通过但最终渲染冻结

  

这是最诡异的一个坑。

  

在 HyperFrames 的预览里看，视频播得好好的。但渲染成最终 MP4 以后，54 秒、1 分 21 秒、2 分 53 秒这三个位置的视频全变成了静帧，画面冻住不动了。

  

原因是 HyperFrames 渲染视频的方式是逐帧截图再拼起来。浏览器预览时视频正常播放，但逐帧捕获时视频的 seek 机制出了问题，导致某些帧被反复截到同一画面。

  

**解决方案：** 不再把动态视频嵌在 HyperFrames 内部。HF 只负责透明的图文叠加层，真正的背景视频交给 ffmpeg 在最后的合成阶段再接进去。

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=NmNmODVkNzA5N2E5MzFmZmQzYmRkMzY2MmQ3YTQ1MzVfaHV0N3pqUHF2T3VXR2tQQXAzemI4WXRtVUROaDR0bldfVG9rZW46SmRFRGJwZXpJb1c1a2t4TVlwTmNyQlhYbnZiXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

> 最终 MP4 才是事实。预览、抽帧检查、inspect 报告都只是中间证据。

  

### 坑 7：真人在不该出现的时候反复闪回

  

做口播视频时，底层有一条全程运行的真人实拍视频。上面叠加图文层来遮挡和切换画面。

  

问题是，只要图文层的某一段没有完全覆盖，底层的真人全屏画面就会露出来。转场的时候闪一下真人，片尾突然弹出真人全屏，观感非常差。

  

**解决方案：** 在分镜里，每一段必须显式标注是**全屏真人 / PIP 小窗 / 无真人**。不允许隐藏的真人全屏作为默认兜底。片尾用最后一帧画面冻住，不让底层露出来。

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=MzFlNzkwNGFmY2Q3MDI0MGM4YmMwMGMwYWRkMzE3NzZfZXFmZ2xiUzJET0E4d1BzQlVEcFo1ZllOa3p4UUJ6b3dfVG9rZW46UmpHQWJNVmxob2RyVVp4QTZWNGNHazJjbmdkXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

  

### 坑 8：画面跑在嘴巴前面

  

视频里的图文元素按大段落整批出现。比如一段讲了三个槽点，第一个槽点的口播刚开始，三个槽点的文字卡片就全弹出来了。观众还没听到，画面已经剧透完了。

  

金额动画也是一样。嘴上说账号余额耗尽的时候，金额动画已经跑完了。

  

**解决方案：** 所有元素按真实口播的时间码逐个触发。不是这一段都能放，而是说到哪里出哪里。这条规则后来写进了制作规范里，每条新视频强制执行。

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=ZWE2ZDM1MmQyZWNjZWVlYmQ1NmZkNGFkNTExOTdhOWZfbW9MTEQ1WE5ydG1PYWtuc2ZGZjJCTXRtelZFSE14N2pfVG9rZW46VDE5OGJ5T1NJb25tWXB4TDFKNmNuOEpsbkhkXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

  

### 坑 9：元素互相打架

  

口播视频的画面层级很复杂：真人画面、PIP 小窗、字幕条、标题大字、资料卡、截图、红框标注、logo，这些东西要同时出现在一个画面里。

  

结果就是各种互相遮挡。49 秒合照和标题重叠，1 分 15 秒大字和左边模块打架，1 分 56 秒对话被上方文字压住，2 分 31 秒弹窗被字幕和人像挡住。

  

**解决方案：** 给 PIP、字幕、资料卡、截图、红框都划固定的安全区。长文案先压缩文字，不靠缩小字号硬塞。画面大字和字幕互斥，同时出现时只保留一个。

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=M2MwNjRmNGI1YzZlODkzMmViNTMzZGFmMmNjYTYwZjJfdHRDRUxESUFlUUhwVUY1R04zelZ4Nk50NHpwVnZjMXhfVG9rZW46WHltb2JPZlNxb3Fkd0p4cGhxbmNlZGJpbnhkXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=YjRjYzhhMDRjZDA5NWE0NzljM2M4ZTc4OGE3YTI3YWNfOXp1M2FrTU5sNWdvR0I5YWFocTBuZXR4Vm9veUVOSGVfVG9rZW46VVg4RGJaejhJb1loSGx4alIwOGN1SktObmRiXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

最后，才终于让里面的卡片、我的口播小窗口、标题文字以及字幕这些东西之间不会打架。

### 坑 10：AI 自作主张把素材重画了一遍

  

我给了 Codex 一张 Lollipop 的 logo 图片，让它放在视频里。结果它不光放了，还自作主张把这张图重新画成了 SVG，而且把前面一个不该换的 logo 也给换掉了。

  

**解决方案：** 用户给的素材，优先直接引用原文件。没有经过用户确认，不重绘、不换用途、不改格式。图片就用 PNG/JPG 圆形蒙版，不为了代码化去重构成 SVG。

尽管看起来这个问题算是一个小问题，不至于是一个坑，但它其实体现了 Codex 的一个问题：如果它本身自带生图能力，就会优先调用内部的能力，这会导致用户上传的素材产生极大的差异，从而影响整个画面或其他内容。

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=ODVhNzU3NDQ2YzJmYjY5YWJhNWMxOTQ0MjkwMTU5YTJfMkt1SnhTaUtJcWk4MUR1Y1pSdDRZcXhDZUJPc09IeFBfVG9rZW46Q2gwb2JkOVFzb0c1bU94ZDV3WWNXU091blVoXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

  

经过五轮迭代，《创始人手册》终于出片了。可以看上面这个图片，我是让口袋 S 给我复盘了一下都遇到了哪些坑，以及我反复强调的点。几乎一屏幕完全截不下，但是我又怕看不清，大概就截了上半部分。

不过好在最后的效果不错，因为里面有一些轻动效。可以看下面这个视频的某一帧截图，这 4 个模块会依次出现，并跟随着我的口播。关键的这一句话：“做东西这件事变快了，但想东西这件事没有变快”，也能跟随着口播的节奏应时出现。

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=ZDQzYmMzM2M0NTYxNDhiODk5MzEyYjk2NjI1ZTQyNDFfakMxZTlqZTh4VEl3Q0RxV1VFM1lDbFBseXFsbDBjQnhfVG9rZW46WGxBcGJKVGhKb3hwR3R4aVRlSWNTUW9jbkJoXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

## 回过头看：为什么是这两个组合？

  

做完这两条视频，回过头来看，答案其实很简单。

  

**不是工具好坏的问题，是输入形态决定了该走哪条生产线。**

  

你手里有什么，就决定了你该用什么。

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=ZGZkMzU0ODc0YmNlMjQzZDRlNjY5ZTRmMWRkMWZlMmVfcVl1bGJ5NlQ1QTEycjhHVFlMR0JWdGNYVDlFMDlIWnNfVG9rZW46S293YWJRUEU3b0JTSDJ4YnJadmNyYU1NbnpoXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=YWM0MjQxNTYwMTMxNTI4ZTQ0ZTExNWZiOWYwNDY1Y2NfS3hURmlKRlpXTkxqY2xub09Yd0ZrWlEwYlFycmVXaFBfVG9rZW46SXdRSGJTdVdTb01zMlp4eUYxS2NkYTkybkRlXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

这不是我一开始就想清楚的。是踩完了所有坑以后，自然沉淀出来的。因此，项目及指令需要反复迭代微调，最后你要给 Claude 或者是 Codex 一套规则或者是契约。

  

---

  

## 沉淀：我的方法论

  

一个月下来，踩了 10 个坑，做了两类视频，最后沉淀出来的方法论其实就几条：

  

**1. 做视频之前先问：我手里有什么？**

  

这一条决定了你走哪条线。有真人素材就走 Codex + HyperFrames，只有文字和想法就走 Claude Code + Remotion。不要在错误的生产线上浪费时间。

  

**2. 不要跳过文档直接写代码。**

  

DESIGN.md 锁视觉系统，STORYBOARD 锁分镜。跳过这两步直接写代码，必然返工。做视频和做产品一样，先有规范，再有实现。

  

**3. 每次踩坑 = 下一次的规则。**

  

真人闪回这个坑踩完，FULL/PIP/NO_HUMAN 显式标注就成了每条视频的强制检查项。cue 不准踩完，按时间码逐个触发就成了制作规范。代码做视频最大的好处就是，**规则可以写进代码里，下次不会再犯同样的错。**

  

**4. 每条片 = 一批可复用的资产。**

  

Loop Engineer 沉淀了 5 个动效模版，下一条同风格视频直接用。这就是代码做视频的复利效应，做得越多，后面越快。

  

**5. 最终文件才是事实。**

  

预览没问题不代表成片没问题。渲染出来的 MP4 才是你要验收的对象。这条规则拿血换的。

![](https://jawjngeach.feishu.cn/space/api/box/stream/download/asynccode/?code=OWFmZTg1MGMzYzJiODYyOWZlMTU4M2YwZWI0ODMzZjlfRklPN1dyRExXM2NRRGlxNG1WQXlKN2Q3a1R4WU9EMnFfVG9rZW46VXd2R2JQRHdCb0JsZ2l4NzhQSGNBS1U1bmljXzE3ODI1NTAwNDA6MTc4MjU1MzY0MF9WNA&add_watermark=true&scene_type=CCM)

  

## 最后说两句

  

AI 做视频不会自动有审美。

  

但它能在你给了明确标准的情况下快速返工。你说49 秒的合照和标题重叠了，它五分钟就能改好。你说1 分 21 秒的录屏冻住了，它能定位到原因然后修复。

  

**真正重要的不是 AI 能不能做视频，而是你能不能把自己的审美反馈翻译成可执行的检查项。**

  

Vibe Motion 这个词听着很 vibe，做起来其实很工程。

  

但也正因为很工程，它才有可能变成一套可重复、可积累、越做越快的生产方式。

  

这大概就是用代码做视频，最有意思的地方。目前我还在测试中，这只是我在做的案例中明显感觉是坑的点，分享一下。后续如果有什么发现我会再同步。