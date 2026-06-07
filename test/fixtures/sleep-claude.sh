#!/bin/sh
# Dorme ~0.4s poi ecoa stdin (per misurare la serializzazione nei test).
sleep 0.4
exec cat
