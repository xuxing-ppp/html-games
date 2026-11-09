/* Scene crops fill their frame; maps use their own uncropped coordinate space. */
(()=>{const M=globalThis.Ming;
 M.artCatalog={
  'review-corridor':{file:'review-corridor-ink',focus:[.52,.48],cast:['lin'],setting:'复审堂外廊',action:'抱着待赔名单在廊下听审'},
  'names-dispute':{file:'names-dispute-ink',portrait:'names-dispute-portrait-ink',focus:[.5,.52],cast:['you','north','south','elder'],setting:'south',action:'两户与里长核问催单'},
  'boat-recant':{file:'boat-recant-ink',portrait:'boat-recant-portrait-ink',focus:[.5,.55],cast:['you','boat','zhou'],setting:'dock',action:'另问补述、雇主在后'},
  'relief-dispute':{file:'relief-dispute-ink',portrait:'relief-dispute-portrait-ink',focus:[.5,.54],cast:['you','lin','widow','family'],setting:'relief',action:'拒签争议字据、核借米'},
  'escort-night':{file:'escort-night-ink',portrait:'escort-night-portrait-ink',focus:[.5,.58],cast:['you','zhou','scribe'],setting:'dock',action:'夜间护送、拉绳拦阶'},
  county:{file:'county-ink',focus:[.55,.48]},opening:{file:'opening-scene-ink',portrait:'opening-portrait-ink',focus:[.53,.43]},hai:{file:'hai-meeting-ink',portrait:'hai-portrait-ink',focus:[.55,.43]},
  desk:{file:'desk-scene',focus:[.5,.5]},river:{file:'river-scene',focus:[.5,.50]},market:{file:'market-scene',focus:[.45,.5]},letter:{file:'letter-folio',focus:[.5,.5]},
  'granary-audit':{file:'granary-audit-ink',focus:[.46,.22]},'river-rain':{file:'river-rain',focus:[.45,.42]},'river-night':{file:'river-night-ink',focus:[.5,.5]},'desk-night':{file:'desk-night-ink',focus:[.46,.42]},'winter-relief':{file:'winter-relief-ink',focus:[.54,.47]},
  'ending-town':{file:'ending-town-ink',focus:[.5,.5]},'ending-justice':{file:'ending-justice-ink',focus:[.5,.45]},'ending-exile':{file:'ending-exile-ink',focus:[.70,.45]},
  'mystery-restitution':{file:'mystery-restitution-ink',focus:[.63,.4]},'mystery-governor':{file:'mystery-governor-ink',focus:[.40,.42]},'mystery-writer':{file:'mystery-writer-ink',focus:[.40,.43]},
  'north-hearing':{file:'north-hearing-ink',portrait:'north-hearing-portrait-ink',focus:[.56,.45],cast:['you','north'],setting:'yamen',action:'俯案核收据、侧身翻册'},
  'north-repair':{file:'north-repair-ink',focus:[.27,.48],cast:['you','north'],setting:'north',action:'修船处看新旧凭据'},
  'south-doorway':{file:'south-doorway-ink',focus:[.48,.46],cast:['you','south'],setting:'south',action:'门前放低文书听陈述'},
  'estate-dock':{file:'estate-dock-ink',focus:[.34,.48],cast:['you','lu','xu','zhou'],setting:'lu',action:'问账、递单、指认船泊'},
  'lin-hearing':{file:'lin-hearing-ink',focus:[.55,.46],cast:['you','lin'],setting:'yamen',action:'停笔听状、指向等粮住户'},
  'relief-doorway':{file:'relief-doorway-ink',focus:[.47,.49],cast:['you','widow','family','lin'],setting:'relief',action:'落座听家属、两孩在门边'},
  'clerk-account':{file:'clerk-account-ink',focus:[.55,.46],cast:['you','clerk'],setting:'yamen',action:'并列原纸与账册分问'},
  'review-hearing':{file:'review-hearing-ink',focus:[.55,.42],cast:['you','censor','gu','xu'],setting:'复审堂',action:'各陈原据、文官服饰'},
  'enforcement-grain':{file:'enforcement-grain-ink',focus:[.53,.46],cast:['you','lin'],setting:'warehouse',action:'点册执行、登记粮袋'}
 };M.imagePath=file=>`./assets/runtime/${file}.webp`;
})();
