# Матрица прослеживаемости: ТЗ → код → статус

Связь требований технического задания с модулями `ros2_ws`, текущим статусом реализации и приоритетом.

**Источники ТЗ:**
- [TZ_Robot_Welding_System_Full_v2.docx](TZ_Robot_Welding_System_Full_v2.docx) — контрактная версия
- [robot_welding_tz_final (5).docx](robot_welding_tz_final%20(5).docx) — алгоритмы, FSM, FMEA
- [ROADMAP.md](ROADMAP.md) — фазы разработки

**Легенда статусов**

| Статус | Значение |
|---|---|
| ✅ Done | Реализовано, работает в demo |
| ⚠️ Partial | Заготовка / упрощённая версия |
| ❌ Missing | Не реализовано |
| 🔧 HW | Зависит от закупки оборудования |

**Приоритеты:** P0 — блокер SAT; P1 — критический путь; P2 — до ввода; P3 — после SAT

---

## 1. Цели и функциональный цикл

| ID | Требование ТЗ | Модуль ТЗ | Код / пакет | Статус | Приор. | Фаза | Тест |
|---|---|---|---|---|---|---|---|
| TZ-1.1 | Полный автоматический цикл без ручной коррекции траектории | Operator HMI + FSM | `WeldingApp.ts`, — | ❌ | P0 | 2 | TP-01 |
| TZ-1.2 | Работа со STEP и без STEP (модель из скана) | Vision Engine | `ModelLoader.ts`, `PointCloudScanner.ts` | ⚠️ | P1 | 1 | TP-02, TP-03 |
| TZ-1.3 | Три сценария сканирования (а/б/в) | Vision Engine | — | ❌ | P2 | 4–5 | TP-04 |
| TZ-1.4 | Цифровой паспорт шва | Report Generator | — | ❌ | P1 | 6 | TP-05 |
| TZ-1.5 | Библиотека технологических профилей | Database Manager | — | ❌ | P1 | 7 | TP-06 |

---

## 2. Сканирование и Vision Engine

| ID | Требование ТЗ | Модуль ТЗ | Код / пакет | Статус | Приор. | Фаза | Тест |
|---|---|---|---|---|---|---|---|
| TZ-2.1 | Обзорное сканирование большим сканером | Vision Engine | `PointCloudScanner.ts` (sim) | ⚠️ | P1 | 4 | TP-07 |
| TZ-2.2 | Точное сканирование малым сканером на роботе | Vision Engine | — | ❌ | P1 | 4 | TP-08 |
| TZ-2.3 | Частота до 1000 изм./с | Vision Engine | — | 🔧 HW | P2 | 4 | TP-09 |
| TZ-2.4 | Сбор и сшивка облаков (robot + scanner pose) | Vision Engine | — | ❌ | P1 | 4 | TP-10 |
| TZ-2.5 | SOR / Radius Outlier Removal | Vision Engine | — | ❌ | P0 | 1 | TP-11 |
| TZ-2.6 | Voxel Grid Downsampling | Vision Engine | — | ❌ | P1 | 1 | TP-11 |
| TZ-2.7 | MLS / Bilateral smoothing | Vision Engine | — | ❌ | P2 | 1 | TP-11 |
| TZ-2.8 | RANSAC — базовые плоскости | Vision Engine | — | ❌ | P0 | 1 | TP-12 |
| TZ-2.9 | Определение стыков, зазоров, кромок | Vision Engine | `SeamManager.ts` (CAD) | ⚠️ | P0 | 1 | TP-13 |
| TZ-2.10 | Seam refinement по облаку точек | Vision Engine | — | ❌ | P0 | 1 | TP-13 |
| TZ-2.11 | Импорт PLY / ASC / CSV | Vision Engine | — | ❌ | P1 | 1 | TP-14 |
| TZ-2.12 | Температурная компенсация измерений | Calibration Manager | — | 🔧 HW | P2 | 4 | TP-15 |

---

## 3. ICP и регистрация CAD ↔ Scan

| ID | Требование ТЗ | Модуль ТЗ | Код / пакет | Статус | Приор. | Фаза | Тест |
|---|---|---|---|---|---|---|---|
| TZ-3.1 | ICP регистрация облака и CAD | ICP Engine | `icp.py`, `PointCloudScanner.ts` | ⚠️ | P0 | 1 | TP-16 |
| TZ-3.2 | RMS ≤ 0,10 мм | ICP Engine | `icp.py` (RMS в ответе) | ⚠️ | P0 | 1 | TP-16 |
| TZ-3.3 | Запрет сварки при ошибке ICP | ICP Engine + FSM | — | ❌ | P0 | 2 | TP-17 |
| TZ-3.4 | Критерий остановки ICP (ΔRMS, max iter) | ICP Engine | `icp.py` (частично) | ⚠️ | P1 | 1 | TP-16 |
| TZ-3.5 | Авто-определение положения ≥ 99% циклов | ICP Engine | — | ❌ | P0 | 8 | TP-18 |

---

## 4. Поиск швов и траектория

| ID | Требование ТЗ | Модуль ТЗ | Код / пакет | Статус | Приор. | Фаза | Тест |
|---|---|---|---|---|---|---|---|
| TZ-4.1 | Автопоиск швов (стыковые, угловые, тавровые) | Trajectory Planner | `SeamManager.ts` | ⚠️ | P0 | 0–1 | TP-13 |
| TZ-4.2 | Ручной выбор / редактирование швов | Operator HMI | `ModelHighlighter.ts`, `WeldingApp.ts` | ✅ | P2 | 0 | TP-19 |
| TZ-4.3 | Распознавание швов ≥ 98% | Vision Engine | `SeamManager.ts` | ⚠️ | P0 | 8 | TP-20 |
| TZ-4.4 | Построение TCP траектории | Trajectory Planner | `moveit_export.py` | ⚠️ | P0 | 0 | TP-21 |
| TZ-4.5 | NURBS / B-spline сглаживание | Trajectory Planner | — | ❌ | P1 | 0 | TP-21 |
| TZ-4.6 | Угол наклона горелки в waypoints | Trajectory Planner | `moveit_export.py` (упрощ.) | ⚠️ | P0 | 0 | TP-21 |
| TZ-4.7 | Время построения траектории ≤ 60 с | Trajectory Planner | `moveit_export.py` | ⚠️ | P0 | 3 | TP-22 |
| TZ-4.8 | Approach / weld / retract сегменты | Trajectory Planner | `moveit_export.py` | ✅ | P1 | 0 | TP-21 |

---

## 5. Кинематика, достижимость, коллизии

| ID | Требование ТЗ | Модуль ТЗ | Код / пакет | Статус | Приор. | Фаза | Тест |
|---|---|---|---|---|---|---|---|
| TZ-5.1 | FK / IK 6-DOF | Kinematics Solver | `kinematics.py` | ⚠️ | P0 | 0 | TP-23 |
| TZ-5.2 | IK с ориентацией TCP | Kinematics Solver | `kinematics.py` (position-only) | ⚠️ | P0 | 0 | TP-23 |
| TZ-5.3 | Проверка достижимости швов | Kinematics Solver | `reachability.py`, `/api/check/reachability` | ⚠️ | P0 | 0 | TP-24 |
| TZ-5.4 | Поиск углов позиционера | Kinematics Solver | `reachability.py` | ✅ | P1 | 0 | TP-24 |
| TZ-5.5 | Проверка коллизий | Trajectory Planner | MoveIt (не подключено) | ❌ | P0 | 3 | TP-25 |
| TZ-5.6 | Запрет запуска при коллизии | Safety + Planner | — | ❌ | P0 | 3 | TP-25 |
| TZ-5.7 | Синхрон URDF ↔ UI ↔ backend | Calibration Manager | `WorkcellLayout.ts`, `kinematics.py`, URDF | ⚠️ | P0 | 0 | TP-26 |
| TZ-5.8 | Точность TCP ≤ ±0,10 мм | Kinematics Solver | — | ❌ | P0 | 4 | TP-27 |

---

## 6. ROS / MoveIt / исполнение

| ID | Требование ТЗ | Модуль ТЗ | Код / пакет | Статус | Приор. | Фаза | Тест |
|---|---|---|---|---|---|---|---|
| TZ-6.1 | Экспорт плана для MoveIt | Robot Motion Engine | `MoveItExporter.ts`, `moveit_export.py` | ✅ | P0 | 0 | TP-28 |
| TZ-6.2 | rosbridge Web ↔ ROS | Robot Motion Engine | `RosBridgeClient.ts` | ⚠️ | P1 | 3 | TP-29 |
| TZ-6.3 | IK через `/compute_ik` | Robot Motion Engine | `weld_planner_node.py` | ⚠️ | P1 | 3 | TP-30 |
| TZ-6.4 | OMPL планирование (`move_group`) | Robot Motion Engine | — | ❌ | P0 | 3 | TP-31 |
| TZ-6.5 | Исполнение JointTrajectory | Robot Motion Engine | `weld_planner_node.py` (stub) | ⚠️ | P0 | 3 | TP-32 |
| TZ-6.6 | Planning scene + workpiece mesh | Robot Motion Engine | MoveIt config | ❌ | P0 | 3 | TP-33 |
| TZ-6.7 | Positioner в траектории | Robot Motion Engine | URDF + export (частично) | ⚠️ | P1 | 3 | TP-34 |
| TZ-6.8 | RViz markers траектории | Operator HMI | `trajectory_bridge_node.py` | ✅ | P2 | 3 | TP-29 |
| TZ-6.9 | 3D-модель робота в web UI | Operator HMI | — | ❌ | P2 | 3 | TP-35 |
| TZ-6.10 | `/joint_states` → UI | Operator HMI | `RosBridgeClient.ts` (не подключено) | ⚠️ | P2 | 3 | TP-35 |

---

## 7. Сварочная подсистема

| ID | Требование ТЗ | Модуль ТЗ | Код / пакет | Статус | Приор. | Фаза | Тест |
|---|---|---|---|---|---|---|---|
| TZ-7.1 | Интерфейс сварочного источника | Welding Controller IF | — | ❌ | P1 | 5 | TP-36 |
| TZ-7.2 | Профили: ток, U, скорость, проволока, газ | Welding Controller IF | — | ❌ | P1 | 5 | TP-37 |
| TZ-7.3 | Адаптивная коррекция по зазору | Welding Controller IF | — | ❌ | P2 | 5 | TP-38 |
| TZ-7.4 | Удержание горелки по центру стыка | Welding Controller IF | — | ❌ | P2 | 5 | TP-38 |
| TZ-7.5 | Регистрация параметров сварки | Database Manager | — | ❌ | P1 | 5 | TP-39 |
| TZ-7.6 | Авто-стоп при выходе параметров | Safety Supervisor | — | ❌ | P1 | 5 | TP-40 |
| TZ-7.7 | Визуальная симуляция сварки | Operator HMI | `WeldingController.ts` | ⚠️ | P3 | 0 | — |

---

## 8. Контроль качества

| ID | Требование ТЗ | Модуль ТЗ | Код / пакет | Статус | Приор. | Фаза | Тест |
|---|---|---|---|---|---|---|---|
| TZ-8.1 | Пост-сварочное сканирование шва | Vision Engine | — | ❌ | P1 | 6 | TP-41 |
| TZ-8.2 | Катет, усиление, ширина шва | Report Generator | — | ❌ | P1 | 6 | TP-42 |
| TZ-8.3 | PASS / FAIL | Report Generator | — | ❌ | P0 | 6 | TP-43 |
| TZ-8.4 | PDF / XLSX протокол | Report Generator | — | ❌ | P1 | 6 | TP-05 |
| TZ-8.5 | Cp / Cpk статистика | Report Generator | — | ❌ | P3 | 6 | TP-44 |

---

## 9. ПО: архитектура, HMI, интеграции

| ID | Требование ТЗ | Модуль ТЗ | Код / пакет | Статус | Приор. | Фаза | Тест |
|---|---|---|---|---|---|---|---|
| TZ-9.1 | Модульная архитектура | All | `welding_web` + `welding_backend` + `welding_bridge` | ⚠️ | P1 | — | — |
| TZ-9.2 | HMI: 3D, облако, швы, траектория | Operator HMI | `WeldingApp.ts`, `SceneManager.ts` | ✅ | P0 | 0 | TP-45 |
| TZ-9.3 | Роли: оператор / технолог / админ | Operator HMI | — | ❌ | P2 | 7 | TP-46 |
| TZ-9.4 | REST API | Integration | `main.py` | ⚠️ | P1 | 7 | TP-47 |
| TZ-9.5 | MQTT телеметрия | Integration | — | ❌ | P2 | 7 | TP-48 |
| TZ-9.6 | OPC UA | Integration | — | ❌ | P3 | 7 | TP-49 |
| TZ-9.7 | Журнал событий | Logging | — | ❌ | P1 | 2 | TP-50 |
| TZ-9.8 | Самодиагностика перед циклом | Diagnostics | — | ❌ | P1 | 2 | TP-51 |
| TZ-9.9 | FSM: OFFLINE…REPORT, EMERGENCY | FSM | — | ❌ | P0 | 2 | TP-01 |
| TZ-9.10 | FMEA-реакции (10 сценариев) | Safety Supervisor | — | ❌ | P1 | 2, 7 | TP-52 |
| TZ-9.11 | БД: изделия, швы, сканы, отчёты | Database Manager | — | ❌ | P1 | 7 | TP-53 |
| TZ-9.12 | Резервное копирование | Database Manager | — | ❌ | P2 | 7 | TP-54 |
| TZ-9.13 | Буферизация при потере связи с сервером | Database Manager | — | ❌ | P2 | 7 | TP-55 |

---

## 10. Калибровка

| ID | Требование ТЗ | Модуль ТЗ | Код / пакет | Статус | Приор. | Фаза | Тест |
|---|---|---|---|---|---|---|---|
| TZ-10.1 | Hand-eye robot ↔ scanner | Calibration Manager | — | ❌ | P0 | 4 | TP-56 |
| TZ-10.2 | Калибровка robot ↔ table ↔ workpiece | Calibration Manager | — | ❌ | P0 | 4 | TP-56 |
| TZ-10.3 | RMS калибровки ≤ 0,05 мм | Calibration Manager | — | ❌ | P0 | 4 | TP-57 |
| TZ-10.4 | Протокол калибровки (дата, RMS) | Report Generator | — | ❌ | P1 | 4 | TP-58 |
| TZ-10.5 | Калибровочное приспособление (эталон) | HW | — | 🔧 HW | P0 | 4 | TP-57 |

---

## 11. Безопасность (ПО-часть)

| ID | Требование ТЗ | Модуль ТЗ | Код / пакет | Статус | Приор. | Фаза | Тест |
|---|---|---|---|---|---|---|---|
| TZ-11.1 | E-stop → EMERGENCY state | Safety Supervisor | — | ❌ | P0 | 7 | TP-59 |
| TZ-11.2 | Heartbeat robot / scanner timeout | Safety Supervisor | — | ❌ | P1 | 7 | TP-52 |
| TZ-11.3 | Блокировка при открытии двери | Safety Supervisor | — | 🔧 HW | P0 | 7 | TP-60 |
| TZ-11.4 | Запрет сварки: ICP fail, collision, gas | Safety Supervisor | — | ❌ | P0 | 2–3 | TP-17, TP-25 |

---

## 12. Железо и инфраструктура (вне ros2_ws)

| ID | Требование ТЗ | Статус | Фаза ROADMAP |
|---|---|---|---|
| TZ-12.1 | Промышленный робот 6DOF, ±0,05 мм | 🔧 HW | 4 |
| TZ-12.2 | Два лазерных сканера + стойка 3 оси | 🔧 HW | 4 |
| TZ-12.3 | Поворотный стол 250 кг, 360° | 🔧 HW | 4 |
| TZ-12.4 | Термостабилизация сканеров | 🔧 HW | 4 |
| TZ-12.5 | Safety PLC, световые барьеры | 🔧 HW | 4, 7 |
| TZ-12.6 | Сварочный источник + горелка | 🔧 HW | 5 |
| TZ-12.7 | Шкаф управления, пневматика 6 бар | 🔧 HW | 4 |

---

## Сводка покрытия (ПО)

| Статус | Кол-во требований | % |
|---|---|---|
| ✅ Done | 6 | 8% |
| ⚠️ Partial | 22 | 29% |
| ❌ Missing | 41 | 54% |
| 🔧 HW | 7 | 9% |
| **Всего** | **76** | 100% |

*Учитываются только строки с программной реализацией (без чисто аппаратных TZ-12.x).*

---

## Критический путь (P0, не закрыто)

```
TZ-2.5,2.8 → TZ-3.1–3.3 → TZ-4.3,4.4 → TZ-5.5,5.6
    → TZ-6.4–6.6 → TZ-9.9 → TZ-10.1–10.3 → TZ-8.3 → SAT
```

**Ближайшие 5 задач по матрице:**

1. `TZ-2.5,2.8` — FilterPipeline + RANSAC в backend
2. `TZ-3.3` — RMS gate + запрет export при ошибке ICP
3. `TZ-9.9` — FSM backend + авто-цикл UI
4. `TZ-5.5,6.4` — MoveIt collision + OMPL
5. `TZ-4.5` — NURBS smoothing траектории

---

## Связанные документы

- [ROADMAP.md](ROADMAP.md)
- [TEST_PLAN.md](TEST_PLAN.md)
