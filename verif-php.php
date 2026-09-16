<?php header("Content-Type: text/plain"); echo "php-actif " . PHP_VERSION . "
"; echo function_exists("file_put_contents") ? "ecriture-fichier-ok
" : "pas-ecriture
";
