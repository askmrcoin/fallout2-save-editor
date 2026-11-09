# bigstorage

**EN** · [RU](#ru)

Raises the capacity of every container in Fallout 2 — lockers, chests,
footlockers, bags, backpacks and the Highwayman's trunk — to **999**.

Tested with [Fallout 2 CE](https://github.com/alexbatalov/fallout2-ce).

## Usage

Close the game first, then from the repository root:

```sh
go run ./tools/bigstorage ~/Fallout2            # apply
go run ./tools/bigstorage ~/Fallout2 --restore  # undo
```

`~/Fallout2` is the folder that contains `master.dat`.

## How it works

- Reads every item prototype (`proto/items/*.pro`) the same way the engine
  does: `data/` folder, then `patch000.dat`, then `master.dat`.
- Takes every prototype of type *container* and sets its maximum size to 999.
- Looks for `set_car_carry_amount(N)` in the game scripts and changes `N`
  to 999 (car trunk upgrades in New Reno set the trunk size from scripts).
  If the size is set in a different form, it prints
  `possible car trunk size code (not patched)` instead.
- Writes everything into a separate archive **`patch050.dat`** next to
  `master.dat`. The engine loads `patchNNN.dat` files on top of
  `master.dat`, so nothing original is modified.

Why not loose files in `data/proto/items`? The engine wipes that folder
when a save is loaded (it uses it as a working folder), so the files would
disappear.

**Saves are not touched.** Undo = delete `patch050.dat` (or use `--restore`).

---

<a id="ru"></a>

# bigstorage (RU)

Поднимает вместимость всех контейнеров Fallout 2 — шкафчиков, сундуков,
тумбочек, сумок, рюкзаков и багажника машины — до **999**.

Проверено на [Fallout 2 CE](https://github.com/alexbatalov/fallout2-ce).

## Запуск

Сначала закрой игру, затем из корня репозитория:

```sh
go run ./tools/bigstorage ~/Fallout2            # применить
go run ./tools/bigstorage ~/Fallout2 --restore  # откатить
```

`~/Fallout2` — папка, где лежит `master.dat`.

## Как это работает

- Читает описания предметов (`proto/items/*.pro`) так же, как движок:
  папка `data/`, затем `patch000.dat`, затем `master.dat`.
- Всем предметам типа «контейнер» ставит максимальный объём 999.
- Ищет в скриптах игры `set_car_carry_amount(N)` и меняет `N` на 999
  (улучшения багажника в Нью-Рено задают объём из скриптов). Если объём
  задаётся иначе, пишет `possible car trunk size code (not patched)`.
- Всё складывает в отдельный архив **`patch050.dat`** рядом с `master.dat`.
  Движок подгружает `patchNNN.dat` поверх `master.dat`, оригинальные файлы
  не меняются.

Почему не отдельные файлы в `data/proto/items`? Движок очищает эту папку
при загрузке сейва (это его рабочая папка), и файлы пропадают.

**Сейвы не трогаются.** Откат — удалить `patch050.dat` (или `--restore`).
