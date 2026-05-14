# サンプル作業領域

`conciliator.config.json` の既定 watch root。動作確認用のプレースホルダです。

実運用では `conciliator.config.json` の `watchRoots[].path` を、実際に監視したい
共有フォルダ (Excel / Maya ファイルが置かれた場所) に書き換えてください。

ここに `.xlsx` を置いて編集すると、Conciliator が file_event を記録し、
Excel で開くとロックファイル (`~$*.xlsx`) から作業者を推測して claim を生成します。
