import { Icon } from "../../shared/ui";

export type ProviderName = "Codex" | "Agy" | "Pi" | "OpenCode";

const logos: Record<ProviderName, string> = {
  Codex:
    "data:image/svg+xml;base64,PHN2ZyBmaWxsPSIjZjRmNGY0IiBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGhlaWdodD0iMWVtIiBzdHlsZT0iZmxleDpub25lO2xpbmUtaGVpZ2h0OjEiIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjFlbSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+Q29kZXg8L3RpdGxlPjxwYXRoIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTguMDg2LjQ1N2E2LjEwNSA2LjEwNSAwIDAxMy4wNDYtLjQxNWMxLjMzMy4xNTMgMi41MjEuNzIgMy41NjQgMS43YS4xMTcuMTE3IDAgMDAuMTA3LjAyOWMxLjQwOC0uMzQ2IDIuNzYyLS4yMjQgNC4wNjEuMzY2bC4wNjMuMDMuMTU0LjA3NmMxLjM1Ny43MDMgMi4zMyAxLjc3IDIuOTE4IDMuMTk4LjI3OC42NzkuNDE4IDEuMzg4LjQyMSAyLjEyNmE1LjY1NSA1LjY1NSAwIDAxLS4xOCAxLjYzMS4xNjcuMTY3IDAgMDAuMDQuMTU1IDUuOTgyIDUuOTgyIDAgMDExLjU3OCAyLjg5MWMuMzg1IDEuOTAxLS4wMSAzLjYxNS0xLjE4MyA1LjE0bC0uMTgyLjIyYTYuMDYzIDYuMDYzIDAgMDEtMi45MzQgMS44NTEuMTYyLjE2MiAwIDAwLS4xMDguMTAyYy0uMjU1LjczNi0uNTExIDEuMzY0LS45ODcgMS45OTItMS4xOTkgMS41ODItMi45NjIgMi40NjItNC45NDggMi40NTEtMS41ODMtLjAwOC0yLjk4Ni0uNTg3LTQuMjEtMS43MzZhLjE0NS4xNDUgMCAwMC0uMTQtLjAzMmMtLjUxOC4xNjctMS4wNC4xOTEtMS42MDQuMTg1YTUuOTI0IDUuOTI0IDAgMDEtMi41OTUtLjYyMiA2LjA1OCA2LjA1OCAwIDAxLTIuMTQ2LTEuNzgxYy0uMjAzLS4yNjktLjQwNC0uNTIyLS41NTEtLjgyMWE3Ljc0IDcuNzQgMCAwMS0uNDk1LTEuMjgzIDYuMTEgNi4xMSAwIDAxLS4wMTctMy4wNjQuMTY2LjE2NiAwIDAwLjAwOC0uMDc0LjExNS4xMTUgMCAwMC0uMDM3LS4wNjQgNS45NTggNS45NTggMCAwMS0xLjM4LTIuMjAyIDUuMTk2IDUuMTk2IDAgMDEtLjMzMy0xLjU4OSA2LjkxNSA2LjkxNSAwIDAxLjE4OC0yLjEzMmMuNDUtMS40ODQgMS4zMDktMi42NDggMi41NzctMy40OTMuMjgyLS4xODguNTUtLjMzNC44MDItLjQzOC4yODYtLjEyLjU3My0uMjIuODYxLS4zMDRhLjEyOS4xMjkgMCAwMC4wODctLjA4N0E2LjAxNiA2LjAxNiAwIDAxNS42MzUgMi4zMUM2LjMxNSAxLjQ2NCA3LjEzMi44NDYgOC4wODYuNDU3em0tLjgwNCA3Ljg1YS44NDguODQ4IDAgMDAtMS40NzMuODQybDEuNjk0IDIuOTY1LTEuNjg4IDIuODQ4YS44NDkuODQ5IDAgMDAxLjQ2Ljg2NGwxLjk0LTMuMjcyYS44NDkuODQ5IDAgMDAuMDA3LS44NTRsLTEuOTQtMy4zOTN6bTUuNDQ2IDYuMjRhLjg0OS44NDkgMCAwMDAgMS42OTVoNC44NDhhLjg0OS44NDkgMCAwMDAtMS42OTZoLTQuODQ4eiI+PC9wYXRoPjwvc3ZnPg==",
  Agy: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgwIiBoZWlnaHQ9IjE4MCIgdmlld0JveD0iMCAwIDE4MCAxODAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0xNDQuMjQ4IDE0OS4wNjJDMTUxLjc0OCAxNTQuNjg4IDE2Mi45OTggMTUwLjkzOCAxNTIuNjg1IDE0MC42MjVDMTIxLjc0OCAxMTAuNjI1IDEyOC4zMSAyOC4xMjUgODkuODcyNyAyOC4xMjVDNTEuNDM1MiAyOC4xMjUgNTcuOTk3NyAxMTAuNjI1IDI3LjA2MDIgMTQwLjYyNUMxNS44MTAyIDE1MS44NzUgMjcuOTk3NyAxNTQuNjg4IDM1LjQ5NzcgMTQ5LjA2MkM2NC41NjAyIDEyOS4zNzUgNjIuNjg1MiA5NC42ODc1IDg5Ljg3MjcgOTQuNjg3NUMxMTcuMDYgOTQuNjg3NSAxMTUuMTg1IDEyOS4zNzUgMTQ0LjI0OCAxNDkuMDYyWiIgZmlsbD0iIzMxODZGRiIvPgo8bWFzayBpZD0ibWFzazBfNjAwMV80MDkiIHN0eWxlPSJtYXNrLXR5cGU6YWxwaGEiIG1hc2tVbml0cz0idXNlclNwYWNlT25Vc2UiIHg9IjIyIiB5PSIyOCIgd2lkdGg9IjEzNiIgaGVpZ2h0PSIxMjUiPgo8cGF0aCBkPSJNMTQ0LjI0OCAxNDkuMDYyQzE1MS43NDggMTU0LjY4OCAxNjIuOTk4IDE1MC45MzggMTUyLjY4NSAxNDAuNjI1QzEyMS43NDggMTEwLjYyNSAxMjguMzEgMjguMTI1IDg5Ljg3MjcgMjguMTI1QzUxLjQzNTIgMjguMTI1IDU3Ljk5NzcgMTEwLjYyNSAyNy4wNjAyIDE0MC42MjVDMTUuODEwMiAxNTEuODc1IDI3Ljk5NzcgMTU0LjY4OCAzNS40OTc3IDE0OS4wNjJDNjQuNTYwMiAxMjkuMzc1IDYyLjY4NTIgOTQuNjg3NSA4OS44NzI3IDk0LjY4NzVDMTE3LjA2IDk0LjY4NzUgMTE1LjE4NSAxMjkuMzc1IDE0NC4yNDggMTQ5LjA2MloiIGZpbGw9IndoaXRlIi8+CjwvbWFzaz4KPGcgbWFzaz0idXJsKCNtYXNrMF82MDAxXzQwOSkiPgo8ZyBmaWx0ZXI9InVybCgjZmlsdGVyMF9mXzYwMDFfNDA5KSI+CjxlbGxpcHNlIGN4PSIzNi42MjI1IiBjeT0iNDMuMDg3MiIgcng9IjM2LjYyMjUiIHJ5PSI0My4wODcyIiB0cmFuc2Zvcm09Im1hdHJpeCgtMC4xMTI3ODQgMC45OTM2MiAtMC45OTM2MiAtMC4xMTI3ODEgMTA2LjU1NyAtMjYuNDg0NykiIGZpbGw9IiNGRkU0MzIiLz4KPC9nPgo8ZyBmaWx0ZXI9InVybCgjZmlsdGVyMV9mXzYwMDFfNDA5KSI+CjxlbGxpcHNlIGN4PSIxNTUuMTYzIiBjeT0iNTQuOTI5MiIgcng9IjQ3LjQxMTgiIHJ5PSI0OC40NTQxIiB0cmFuc2Zvcm09InJvdGF0ZSg3Ni45MjQzIDE1NS4xNjMgNTQuOTI5MikiIGZpbGw9IiNGQzQxM0QiLz4KPC9nPgo8ZyBmaWx0ZXI9InVybCgjZmlsdGVyMl9mXzYwMDFfNDA5KSI+CjxlbGxpcHNlIGN4PSIxNC42MDA2IiBjeT0iNjUuNDQyNSIgcng9IjQ5LjU1MTUiIHJ5PSI2NC4xOTIiIHRyYW5zZm9ybT0icm90YXRlKDc0LjEyNTcgMTQuNjAwNiA2NS40NDI1KSIgZmlsbD0iIzAwQjk1QyIvPgo8L2c+CjxnIGZpbHRlcj0idXJsKCNmaWx0ZXIzX2ZfNjAwMV80MDkpIj4KPGVsbGlwc2UgY3g9IjE0LjYwMDYiIGN5PSI2NS40NDI1IiByeD0iNDkuNTUxNSIgcnk9IjY0LjE5MiIgdHJhbnNmb3JtPSJyb3RhdGUoNzQuMTI1NyAxNC42MDA2IDY1LjQ0MjUpIiBmaWxsPSIjMDBCOTVDIi8+CjwvZz4KPGcgZmlsdGVyPSJ1cmwoI2ZpbHRlcjRfZl82MDAxXzQwOSkiPgo8ZWxsaXBzZSBjeD0iMTguMTIyNiIgY3k9IjY3LjQxNCIgcng9IjQ4LjU2NzkiIHJ5PSI1My40Njg4IiB0cmFuc2Zvcm09InJvdGF0ZSg0NS42MDY1IDE4LjEyMjYgNjcuNDE0KSIgZmlsbD0iIzAwQjk1QyIvPgo8L2c+CjxnIGZpbHRlcj0idXJsKCNmaWx0ZXI1X2ZfNjAwMV80MDkpIj4KPGVsbGlwc2UgY3g9IjEyMS44MzciIGN5PSIxNjYuOTQ1IiByeD0iNDYuNjM1NiIgcnk9IjQ0LjkwODQiIHRyYW5zZm9ybT0icm90YXRlKDc2LjkyNDMgMTIxLjgzNyAxNjYuOTQ1KSIgZmlsbD0iIzMxODZGRiIvPgo8L2c+CjxnIGZpbHRlcj0idXJsKCNmaWx0ZXI2X2ZfNjAwMV80MDkpIj4KPGVsbGlwc2UgY3g9IjUzLjk0NTYiIGN5PSI1Ni44OTk3IiByeD0iNTMuOTQ1NiIgcnk9IjU2Ljg5OTciIHRyYW5zZm9ybT0ibWF0cml4KC0wLjQwOTUzOSAwLjkxMjI5MyAtMC45MTIyOTQgLTAuNDA5NTM3IDE2Mi44MTEgLTI1Ljg5NSkiIGZpbGw9IiNGQkJDMDQiLz4KPC9nPgo8ZyBmaWx0ZXI9InVybCgjZmlsdGVyN19mXzYwMDFfNDA5KSI+CjxwYXRoIGQ9Ik00LjIxNTU3IDIzOS4wNjNDLTI1LjMyMzEgMjI3LjQ2NyAyNS4xNTc3IDEzMi4wNjEgMzcuNzEwNSAxMDAuMDg1QzUwLjI2MzQgNjguMTA5NyA4NC4zODUzIDUxLjU4ODggMTEzLjkyNCA2My4xODQ4QzE0My40NjMgNzQuNzgwOSAxNzguNDc0IDEzOC42NSAxNjUuOTIxIDE3MC42MjZDMTUzLjM2OCAyMDIuNjAxIDMzLjc1NDMgMjUwLjY1OSA0LjIxNTU3IDIzOS4wNjNaIiBmaWxsPSIjMzE4NkZGIi8+CjwvZz4KPGcgZmlsdGVyPSJ1cmwoI2ZpbHRlcjhfZl82MDAxXzQwOSkiPgo8cGF0aCBkPSJNMTgzLjE5NyAxMjAuMzE1QzE3NS4yODkgMTI5LjU0NSAxNTQuNjUyIDEyNC44MzkgMTM3LjEwMiAxMDkuODAzQzExOS41NTMgOTQuNzY2OCAxMTEuNzM4IDc1LjA5NTUgMTE5LjY0NiA2NS44NjU2QzEyNy41NTQgNTYuNjM1NyAxNDguMTkxIDYxLjM0MjMgMTY1Ljc0IDc2LjM3ODJDMTgzLjI4OSA5MS40MTQgMTkxLjEwNSAxMTEuMDg1IDE4My4xOTcgMTIwLjMxNVoiIGZpbGw9IiM3NDlCRkYiLz4KPC9nPgo8ZyBmaWx0ZXI9InVybCgjZmlsdGVyOV9mXzYwMDFfNDA5KSI+CjxlbGxpcHNlIGN4PSIxNDguOTI4IiBjeT0iMzYuNzI1MiIgcng9IjcxLjEwMTgiIHJ5PSI0NC4xOTkiIHRyYW5zZm9ybT0icm90YXRlKDM0LjA3NjMgMTQ4LjkyOCAzNi43MjUyKSIgZmlsbD0iI0ZDNDEzRCIvPgo8L2c+CjxnIGZpbHRlcj0idXJsKCNmaWx0ZXIxMF9mXzYwMDFfNDA5KSI+CjxlbGxpcHNlIGN4PSIzNy44NDgiIGN5PSI0Ni4wMzQ2IiByeD0iMzguMTAwOCIgcnk9IjIyLjE1NzUiIHRyYW5zZm9ybT0icm90YXRlKDExMi41MTYgMzcuODQ4IDQ2LjAzNDYpIiBmaWxsPSIjRkZFRTQ4Ii8+CjwvZz4KPC9nPgo8ZGVmcz4KPGZpbHRlciBpZD0iZmlsdGVyMF9mXzYwMDFfNDA5IiB4PSI0LjA5NTkxIiB5PSItNDQuMTc2MSIgd2lkdGg9IjExMS4wMzciIGhlaWdodD0iOTguNDQxNiIgZmlsdGVyVW5pdHM9InVzZXJTcGFjZU9uVXNlIiBjb2xvci1pbnRlcnBvbGF0aW9uLWZpbHRlcnM9InNSR0IiPgo8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSI2LjI1MjM0Ii8+CjwvZmlsdGVyPgo8ZmlsdGVyIGlkPSJmaWx0ZXIxX2ZfNjAwMV80MDkiIHg9IjQ2LjI5NzQiIHk9Ii01My4wMDA5IiB3aWR0aD0iMjE3LjczMSIgaGVpZ2h0PSIyMTUuODYiIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj4KPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMzAuMjI2OCIvPgo8L2ZpbHRlcj4KPGZpbHRlciBpZD0iZmlsdGVyMl9mXzYwMDFfNDA5IiB4PSItMTAwLjAxOCIgeT0iLTM2Ljc1NTgiIHdpZHRoPSIyMjkuMjM4IiBoZWlnaHQ9IjIwNC4zOTciIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj4KPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMjUuNjk1NyIvPgo8L2ZpbHRlcj4KPGZpbHRlciBpZD0iZmlsdGVyM19mXzYwMDFfNDA5IiB4PSItMTAwLjAxOCIgeT0iLTM2Ljc1NTgiIHdpZHRoPSIyMjkuMjM4IiBoZWlnaHQ9IjIwNC4zOTciIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj4KPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMjUuNjk1NyIvPgo8L2ZpbHRlcj4KPGZpbHRlciBpZD0iZmlsdGVyNF9mXzYwMDFfNDA5IiB4PSItODQuMzk4NSIgeT0iLTM1LjAwMyIgd2lkdGg9IjIwNS4wNDIiIGhlaWdodD0iMjA0LjgzNCIgZmlsdGVyVW5pdHM9InVzZXJTcGFjZU9uVXNlIiBjb2xvci1pbnRlcnBvbGF0aW9uLWZpbHRlcnM9InNSR0IiPgo8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIyNS42OTU3Ii8+CjwvZmlsdGVyPgo8ZmlsdGVyIGlkPSJmaWx0ZXI1X2ZfNjAwMV80MDkiIHg9IjI3Ljk5MTUiIHk9IjcxLjU0OTMiIHdpZHRoPSIxODcuNjkxIiBoZWlnaHQ9IjE5MC43OTEiIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj4KPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMjQuNDE4NCIvPgo8L2ZpbHRlcj4KPGZpbHRlciBpZD0iZmlsdGVyNl9mXzYwMDFfNDA5IiB4PSItMTEuODgwOCIgeT0iLTk4LjcwODUiIHdpZHRoPSIyMDEuMzgiIGhlaWdodD0iMTk3LjQ1IiBmaWx0ZXJVbml0cz0idXNlclNwYWNlT25Vc2UiIGNvbG9yLWludGVycG9sYXRpb24tZmlsdGVycz0ic1JHQiI+CjxmZUdhdXNzaWFuQmx1ciBzdGREZXZpYXRpb249IjIyLjEzMDEiLz4KPC9maWx0ZXI+CjxmaWx0ZXIgaWQ9ImZpbHRlcjdfZl82MDAxXzQwOSIgeD0iLTQ0LjQ0MzIiIHk9IjE5Ljk1MjIiIHdpZHRoPSIyNTIuNTEzIiBoZWlnaHQ9IjI2MC40MDQiIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj4KPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMTkuNzYzMSIvPgo8L2ZpbHRlcj4KPGZpbHRlciBpZD0iZmlsdGVyOF9mXzYwMDFfNDA5IiB4PSI4MS4xOTE1IiB5PSIyNS43NzIyIiB3aWR0aD0iMTQwLjQ2IiBoZWlnaHQ9IjEzNC42MzciIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj4KPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMTcuNjg0MyIvPgo8L2ZpbHRlcj4KPGZpbHRlciBpZD0iZmlsdGVyOV9mXzYwMDFfNDA5IiB4PSI1NS4xNDk5IiB5PSItNDcuMjUzMSIgd2lkdGg9IjE4Ny41NTUiIGhlaWdodD0iMTY3Ljk1NyIgZmlsdGVyVW5pdHM9InVzZXJTcGFjZU9uVXNlIiBjb2xvci1pbnRlcnBvbGF0aW9uLWZpbHRlcnM9InNSR0IiPgo8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIxNC45MzY1Ii8+CjwvZmlsdGVyPgo8ZmlsdGVyIGlkPSJmaWx0ZXIxMF9mXzYwMDFfNDA5IiB4PSItMjQuMjYzMyIgeT0iLTI3LjE1MTUiIHdpZHRoPSIxMjQuMjIzIiBoZWlnaHQ9IjE0Ni4zNzIiIGZpbHRlclVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIj4KPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMTguNDg2NSIvPgo8L2ZpbHRlcj4KPC9kZWZzPgo8L3N2Zz4K",
  Pi: "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA4MDAgODAwIj4KICA8cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjgwMCIgcng9IjEyMCIgZmlsbD0iIzA5MDkwYiIvPgogIDxwYXRoIGZpbGw9IiNmZmYiIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iCiAgICBNMTY1LjI5IDE2NS4yOQogICAgSDUxNy4zNgogICAgVjQwMAogICAgSDQwMAogICAgVjUxNy4zNgogICAgSDI4Mi42NQogICAgVjYzNC43MgogICAgSDE2NS4yOQogICAgWgogICAgTTI4Mi42NSAyODIuNjUKICAgIFY0MDAKICAgIEg0MDAKICAgIFYyODIuNjUKICAgIFoKICAiLz4KICA8cGF0aCBmaWxsPSIjZmZmIiBkPSJNNTE3LjM2IDQwMCBINjM0LjcyIFY2MzQuNzIgSDUxNy4zNiBaIi8+Cjwvc3ZnPgo=",
  OpenCode:
    "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQwIiBoZWlnaHQ9IjMwMCIgdmlld0JveD0iMCAwIDI0MCAzMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxnIGNsaXAtcGF0aD0idXJsKCNjbGlwMF8xNDAxXzg2MjgzKSI+CjxtYXNrIGlkPSJtYXNrMF8xNDAxXzg2MjgzIiBzdHlsZT0ibWFzay10eXBlOmx1bWluYW5jZSIgbWFza1VuaXRzPSJ1c2VyU3BhY2VPblVzZSIgeD0iMCIgeT0iMCIgd2lkdGg9IjI0MCIgaGVpZ2h0PSIzMDAiPgo8cGF0aCBkPSJNMjQwIDBIMFYzMDBIMjQwVjBaIiBmaWxsPSJ3aGl0ZSIvPgo8L21hc2s+CjxnIG1hc2s9InVybCgjbWFzazBfMTQwMV84NjI4MykiPgo8cGF0aCBkPSJNMTgwIDI0MEg2MFYxMjBIMTgwVjI0MFoiIGZpbGw9IiM0QjQ2NDYiLz4KPHBhdGggZD0iTTE4MCA2MEg2MFYyNDBIMTgwVjYwWk0yNDAgMzAwSDBWMEgyNDBWMzAwWiIgZmlsbD0iI0YxRUNFQyIvPgo8L2c+CjwvZz4KPGRlZnM+CjxjbGlwUGF0aCBpZD0iY2xpcDBfMTQwMV84NjI4MyI+CjxyZWN0IHdpZHRoPSIyNDAiIGhlaWdodD0iMzAwIiBmaWxsPSJ3aGl0ZSIvPgo8L2NsaXBQYXRoPgo8L2RlZnM+Cjwvc3ZnPgo=",
};

export function ProviderChoice({
  name,
  command,
  detail,
  status,
  selected,
  locked,
  planned,
  onSelect,
}: {
  name: ProviderName;
  command: string;
  detail: string;
  status: string;
  selected: boolean;
  locked: boolean;
  planned?: boolean;
  onSelect?: () => void;
}) {
  const displayName = name === "Agy" ? "Antigravity" : name;
  return (
    <button
      type="button"
      className={`group min-w-0 overflow-hidden border text-left text-otto-text transition-[background,border-color] duration-200 ease-otto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-otto-input-selected ${
        selected
          ? "col-start-1 row-span-3 flex flex-col rounded-otto-launcher border-otto-line-focused bg-otto-selected p-[5px]"
          : "col-start-2 flex items-center gap-2 rounded-otto-card border-otto-line bg-otto-control p-[7px] hover:border-otto-line-hover hover:bg-otto-control-hover"
      } ${planned ? "opacity-60" : ""}`}
      disabled={locked || planned || !onSelect}
      aria-pressed={selected}
      onClick={onSelect}
      title={status}
    >
      {selected ? (
        <>
          <span className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden rounded-[11px] bg-[radial-gradient(ellipse_at_50%_40%,var(--color-otto-art-halo),transparent_68%),linear-gradient(150deg,var(--color-otto-art-agent-start),var(--color-otto-art-agent-end))]">
            <span className="pointer-events-none absolute h-[150px] w-[150px] rounded-full border border-otto-line-strong opacity-50 [transform:rotateX(55deg)_rotate(-23deg)]" />
            <span className="absolute left-3 top-[11px] font-otto-mono text-otto-2xs tracking-[0.05em] text-otto-text-tertiary">
              PROVIDER / {name === "Codex" ? "01" : name === "Agy" ? "02" : "03"}
            </span>
            <span className="absolute right-[10px] top-[10px] flex size-5 items-center justify-center rounded-full bg-otto-invert-bg text-otto-invert-text">
              <Icon name="check" size={12} />
            </span>
            <img
              src={logos[name]}
              alt=""
              className="relative z-10 size-[92px] object-contain [filter:drop-shadow(0_8px_11px_rgba(0,0,0,.23))]"
              draggable={false}
            />
          </span>
          <span className="flex w-full items-end justify-between gap-[7px] px-2 pb-[9px] pt-[13px]">
            <span className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-[17px] font-semibold tracking-[-0.03em]">
                {displayName}
              </span>
              <span className="truncate text-otto-xs text-otto-text-tertiary">{detail}</span>
            </span>
            <span className="shrink-0 rounded-[7px] border border-otto-line-hover px-[7px] py-[5px] font-otto-mono text-otto-xs text-otto-text-secondary">
              {command}
            </span>
          </span>
        </>
      ) : (
        <>
          <span className="flex h-full min-h-[52px] w-[54px] shrink-0 items-center justify-center rounded-otto-control bg-[linear-gradient(145deg,var(--color-otto-art-agent-start),var(--color-otto-art-agent-end))] max-[430px]:w-[43px]">
            <img
              src={logos[name]}
              alt=""
              className="size-[36px] object-contain max-[430px]:size-[30px]"
              draggable={false}
            />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="truncate text-otto-sm font-semibold">{displayName}</span>
            <span className="truncate font-otto-mono text-otto-xs text-otto-muted">{command}</span>
          </span>
          {planned ? (
            <span className="shrink-0 text-otto-2xs text-otto-muted">Planned</span>
          ) : (
            <span aria-hidden="true" className="shrink-0 text-otto-text-tertiary">
              ›
            </span>
          )}
        </>
      )}
    </button>
  );
}
