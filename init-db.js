// Initialize database with seed data
const db = require('./db');

console.log('Initializing database...');

// 既存26社を初期登録
if (db.companies.count() === 0) {
  const companies = [
    "井東工業", "岩田", "OS", "岡部", "オグリ", "カンドー", "KP", "健商",
    "鋼建", "成和", "ソリタ", "大央", "建和", "塗夢装", "長嶺", "奈良谷",
    "野口", "馬場", "浜本工業", "日立", "不二", "藤喜", "丸清商店", "ミリー",
    "ユーホク", "YD"
  ].map(name => ({
    name, representative: '', phone: '', email: '', address: '', mainType: '', notes: ''
  }));
  db.companies.bulkInsert(companies);
  console.log(`  ✓ Inserted ${companies.length} companies`);
}

// 工事マスタ
if (db.constructions.count() === 0) {
  db.constructions.bulkInsert([{
    name: '(仮称)川崎区日進町ビル新築工事',
    location: '神奈川県川崎市川崎区日進町',
    startDate: '2025-03-24',
    endDate: '2026-03-31',
    client: '',
    manager: '',
    status: '進行中',
    notes: ''
  }]);
  console.log('  ✓ Inserted construction master');
}

// 工事種別マスタ
if (db.constructionTypes.count() === 0) {
  const types = [
    ['外構', '土木'], ['鉄筋', '躯体'], ['型枠', '躯体'], ['コンクリート', '躯体'],
    ['鉄骨', '躯体'], ['土工', '土木'], ['解体', '土木'], ['防水', '仕上'],
    ['塗装', '仕上'], ['内装', '仕上'], ['建具', '仕上'], ['タイル', '仕上'],
    ['電気', '設備'], ['給排水衛生設備', '設備'], ['空調換気設備', '設備'],
    ['ガス設備', '設備'], ['エレベーター', '設備'], ['屋根', '仕上'],
    ['サッシ', '仕上'], ['左官', '仕上']
  ].map(([name, category]) => ({ name, category, notes: '' }));
  db.constructionTypes.bulkInsert(types);
  console.log(`  ✓ Inserted ${types.length} construction types`);
}

// ユーザーマスタ
if (db.users.count() === 0) {
  db.users.bulkInsert([{
    name: '中辻 良太',
    position: '',
    department: '',
    email: 'nakatsuji777@gmail.com',
    loginId: '',
    role: '管理者',
    notes: ''
  }]);
  console.log('  ✓ Inserted user master');
}

// コメント定型例（70件）
if (db.commentTemplates.count() === 0) {
  const templates = [
    // 1. 予算
    ['budget', '厳しい予算にも柔軟にご対応いただきました。'],
    ['budget', '追加工事の見積も適正価格でご提示いただきました。'],
    ['budget', 'コスト削減のご提案をいただき、大変助かりました。'],
    ['budget', '予算内で良質な工事をしていただきました。'],
    ['budget', '見積精度が高く、予算管理がしやすかったです。'],
    ['budget', '予算に対する意識が高く、無駄のない施工でした。'],
    ['budget', '特にありませんでした。'],
    // 2. 品質
    ['quality', '仕上がりが丁寧で、当社の品質基準を十分に満たしていただきました。'],
    ['quality', '養生・後始末が適切で、現場が常に整理されていました。'],
    ['quality', '細部まで気を配った仕上がりでした。'],
    ['quality', '再施工なく、一度で高品質な仕上がりとなりました。'],
    ['quality', '当社の指示通りの品質を確保していただきました。'],
    ['quality', '丁寧な施工で、お客様にも喜んでいただけました。'],
    ['quality', '特にありませんでした。'],
    // 3. 工程
    ['schedule', '予定された工程通りに作業を進めていただきました。'],
    ['schedule', '工期を短縮していただき、後の工程に余裕ができました。'],
    ['schedule', '天候不良時の対応が迅速で、遅延を最小限に抑えられました。'],
    ['schedule', '進捗報告がこまめで、工程管理がしやすかったです。'],
    ['schedule', '他業者との調整がスムーズで、全体工程に貢献いただきました。'],
    ['schedule', '段取りが良く、効率的に作業を進めていただきました。'],
    ['schedule', '特にありませんでした。'],
    // 4. 安全
    ['safety', '安全意識が高く、保護具着用も徹底されていました。'],
    ['safety', 'KY活動・朝礼への参加が積極的でした。'],
    ['safety', '事故・ヒヤリハットゼロで完了いただきました。'],
    ['safety', '現場の整理整頓が行き届いており、安全な作業環境でした。'],
    ['safety', '危険予知活動が徹底されており安心できました。'],
    ['safety', '安全書類の管理も適切に行われていました。'],
    ['safety', '特にありませんでした。'],
    // 5. コミュニケーション
    ['communication', '他業者との対応が良く、近隣にも配慮していただきました。'],
    ['communication', '報連相が徹底されており、現場運営がスムーズでした。'],
    ['communication', '当社担当者との意思疎通が円滑でした。'],
    ['communication', '近隣対応も丁寧で、トラブルなく進められました。'],
    ['communication', '協調性があり、他業者との連携も取れていました。'],
    ['communication', '現場マナーが良く、清潔感のある対応でした。'],
    ['communication', '特にありませんでした。'],
    // 6. 書類
    ['document', '必要書類を期日通りに提出いただきました。'],
    ['document', '施工計画書の内容が詳細で分かりやすかったです。'],
    ['document', '安全書類の不備がなく、スムーズに承認できました。'],
    ['document', '日報・週報の提出が適切に行われていました。'],
    ['document', '完了報告書の写真添付など、丁寧に対応いただきました。'],
    ['document', '変更時の書類対応も迅速でした。'],
    ['document', '特にありませんでした。'],
    // 7. 提案
    ['proposal', '工期短縮のご提案をいただき、実際に大幅短縮できました。'],
    ['proposal', 'コスト削減につながる代替工法をご提案いただきました。'],
    ['proposal', '高い技術力で、難しい施工も問題なく完了いただきました。'],
    ['proposal', '現場での創意工夫が見られ、品質向上につながりました。'],
    ['proposal', '経験豊富な職人による的確な対応でした。'],
    ['proposal', '他現場でも採用したい工夫がありました。'],
    ['proposal', '特にありませんでした。'],
    // 良かった点
    ['good', '予定工期を大幅に短縮していただき、後工程に余裕ができました。'],
    ['good', '仕上がりが丁寧で、お客様にもご好評いただきました。'],
    ['good', '安全管理が徹底されており、無事故で完了できました。'],
    ['good', 'コミュニケーションが円滑で、現場運営がスムーズでした。'],
    ['good', '予算内で高品質な工事を完成させていただきました。'],
    ['good', '他業者との連携が良く、全体工程に貢献いただきました。'],
    ['good', '近隣対応も丁寧で、トラブルなく完了できました。'],
    // 改善点
    ['improve', '特にありませんでした。'],
    ['improve', '書類提出をもう少し早めていただけると助かります。'],
    ['improve', '進捗報告の頻度を上げていただけると安心です。'],
    ['improve', '現場の整理整頓をより徹底いただけると幸いです。'],
    ['improve', '打合せ時の参加者を増やしていただけると円滑に進められます。'],
    ['improve', '変更事項の連絡をより迅速にお願いしたいです。'],
    ['improve', '近隣への挨拶・配慮をより丁寧にお願いしたいです。'],
    // 期待・要望
    ['expectation', '今後ともよろしくお願いいたします。'],
    ['expectation', '次回も継続してお取引させていただきたく存じます。'],
    ['expectation', '他現場でもご協力いただけますと幸いです。'],
    ['expectation', '今後ともご指導のほどよろしくお願いいたします。'],
    ['expectation', '引き続きよろしくお願いいたします。'],
    ['expectation', 'より大規模な案件もぜひお願いしたいと存じます。'],
    ['expectation', '御社の技術力に期待しております。今後もよろしくお願いいたします。'],
  ].map(([category, text], i) => ({ category, text, displayOrder: i }));
  db.commentTemplates.bulkInsert(templates);
  console.log(`  ✓ Inserted ${templates.length} comment templates`);
}

console.log('Done.');
