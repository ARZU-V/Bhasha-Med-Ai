import { useState } from 'react';
import { motion } from 'framer-motion';
import { loadProfile } from '../components/ProfileModal';

type DietPlan = {
  condition: string;
  icon: string;
  color: string;
  border: string;
  text: string;
  eat: { category: string; items: string[] }[];
  avoid: string[];
  tips: string[];
};

const DIET_PLANS: Record<string, DietPlan> = {
  Diabetes: {
    condition: 'Diabetes / High Blood Sugar',
    icon: '🩸',
    color: 'bg-rose-500/8',
    border: 'border-rose-500/20',
    text: 'text-rose-600',
    eat: [
      { category: 'Grains & Carbs', items: ['Brown rice', 'Multigrain roti', 'Oats', 'Barley', 'Quinoa'] },
      { category: 'Vegetables', items: ['Bitter gourd (karela)', 'Spinach', 'Fenugreek (methi)', 'Broccoli', 'Cucumber'] },
      { category: 'Protein & Fats', items: ['Dal', 'Eggs', 'Chicken (grilled)', 'Nuts (small qty)', 'Curd (low fat)'] },
      { category: 'Fruits (limited)', items: ['Guava', 'Jamun', 'Apple', 'Papaya', 'Pear'] },
    ],
    avoid: ['White rice (maida)', 'Sweets & mithai', 'Fruit juices & soft drinks', 'Fried snacks', 'Alcohol', 'White bread'],
    tips: [
      'Eat small meals every 3-4 hours instead of 3 big meals',
      'Walk 20-30 min after dinner — lowers blood sugar naturally',
      'Check blood sugar before and 2 hrs after meals',
      'Avoid skipping meals — causes blood sugar crashes',
    ],
  },
  'Hypertension / BP': {
    condition: 'Hypertension / High Blood Pressure',
    icon: '❤️',
    color: 'bg-red-500/8',
    border: 'border-red-500/20',
    text: 'text-red-600',
    eat: [
      { category: 'Vegetables', items: ['Spinach', 'Beetroot', 'Garlic', 'Tomatoes', 'Sweet potato'] },
      { category: 'Fruits', items: ['Banana', 'Orange', 'Watermelon', 'Pomegranate', 'Avocado'] },
      { category: 'Grains & Protein', items: ['Oats', 'Brown rice', 'Dal', 'Fish (salmon)', 'Low-fat curd'] },
      { category: 'Others', items: ['Coconut water', 'Flaxseeds', 'Dark chocolate (small)', 'Olive oil'] },
    ],
    avoid: ['Excess salt (namak)', 'Pickles & papads', 'Processed & packaged foods', 'Red meat', 'Fried foods', 'Alcohol', 'Caffeine (limit)'],
    tips: [
      'Limit salt to < 5g/day — use lemon & herbs instead',
      'DASH diet is proven to lower BP in 2 weeks',
      'Reduce stress — practice pranayama daily',
      'Walk 30 min per day, avoid heavy exercise if BP is very high',
    ],
  },
  'Heart Disease': {
    condition: 'Heart Disease / Cardiac Care',
    icon: '🫀',
    color: 'bg-orange-500/8',
    border: 'border-orange-500/20',
    text: 'text-orange-600',
    eat: [
      { category: 'Heart-healthy', items: ['Oats', 'Salmon / mackerel', 'Walnuts', 'Flaxseeds', 'Olive oil'] },
      { category: 'Vegetables & Fruits', items: ['Spinach', 'Broccoli', 'Berries', 'Orange', 'Pomegranate'] },
      { category: 'Protein', items: ['Dal', 'Moong', 'Egg whites', 'Tofu', 'Low-fat paneer'] },
    ],
    avoid: ['Trans fats (vanaspati, dalda)', 'Red meat', 'Fried foods', 'Excess salt', 'Full-fat dairy', 'Refined sugar', 'Alcohol'],
    tips: [
      'Follow the Mediterranean diet pattern for best heart health',
      'Omega-3 fatty acids (fish, walnuts) reduce inflammation',
      'No more than 1 tsp oil per meal',
      'Light walking is fine — avoid sudden intense exercise',
    ],
  },
  Asthma: {
    condition: 'Asthma / Respiratory',
    icon: '🫁',
    color: 'bg-sky-500/8',
    border: 'border-sky-500/20',
    text: 'text-sky-600',
    eat: [
      { category: 'Anti-inflammatory', items: ['Ginger (adrak)', 'Turmeric (haldi)', 'Garlic', 'Honey', 'Apples'] },
      { category: 'Vitamins', items: ['Orange', 'Guava', 'Tomato', 'Carrot', 'Sweet potato'] },
      { category: 'Magnesium-rich', items: ['Spinach', 'Pumpkin seeds', 'Dark chocolate', 'Bananas', 'Avocado'] },
    ],
    avoid: ['Sulphite-rich foods (wine, dried fruits)', 'Cold drinks & ice cream', 'Preservatives', 'Peanuts (if allergic)', 'Excess salt'],
    tips: [
      'Warm ginger-honey tea soothes airways',
      'Keep a food diary to identify trigger foods',
      'Stay hydrated — dry airways worsen asthma',
      'Avoid eating late at night — acid reflux worsens asthma',
    ],
  },
  'Kidney Disease': {
    condition: 'Kidney Disease / CKD',
    icon: '🫘',
    color: 'bg-violet-500/8',
    border: 'border-violet-500/20',
    text: 'text-violet-600',
    eat: [
      { category: 'Low-potassium options', items: ['White rice', 'White bread', 'Cabbage', 'Cauliflower', 'Apple'] },
      { category: 'Low-phosphorus', items: ['Egg whites', 'Rice milk', 'Bread', 'Unenriched pasta', 'Corn'] },
      { category: 'Safe vegetables', items: ['Cabbage', 'Green beans', 'Garlic', 'Onion', 'Lettuce'] },
    ],
    avoid: ['Bananas, oranges (high potassium)', 'Potatoes (limit)', 'Nuts & seeds (high phosphorus)', 'Dairy (large qty)', 'Salt substitutes', 'Packaged foods'],
    tips: [
      'Fluid restriction may be needed — ask your nephrologist',
      'Avoid NSAIDs (ibuprofen, diclofenac) — they damage kidneys',
      'Protein restriction may be prescribed by your doctor',
      'Monitor blood pressure and blood sugar closely',
    ],
  },
  Thyroid: {
    condition: 'Thyroid (Hypothyroidism)',
    icon: '🦋',
    color: 'bg-amber-500/8',
    border: 'border-amber-500/20',
    text: 'text-amber-600',
    eat: [
      { category: 'Iodine-rich', items: ['Iodized salt', 'Fish', 'Eggs', 'Dairy (moderate)', 'Seaweed'] },
      { category: 'Selenium-rich', items: ['Brazil nuts (2/day)', 'Sunflower seeds', 'Tuna', 'Whole grains', 'Mushrooms'] },
      { category: 'Others', items: ['Coconut oil', 'Bone broth', 'Lean meat', 'Fruits', 'Most vegetables'] },
    ],
    avoid: ['Raw goitrogen foods (excess raw cabbage/broccoli)', 'Soy products (in large qty)', 'Gluten (if hashimoto\'s)', 'Alcohol', 'Processed foods'],
    tips: [
      'Take thyroid medicine on an empty stomach, 30 min before food',
      'Don\'t take thyroid medicine with calcium, iron supplements',
      'Cooking cruciferous vegetables reduces goitrogen effect',
      'Regular sleep & stress management improve thyroid function',
    ],
  },
};

const GENERAL_PLAN: DietPlan = {
  condition: 'General Healthy Diet',
  icon: '🥗',
  color: 'bg-success/8',
  border: 'border-success/20',
  text: 'text-success',
  eat: [
    { category: 'Grains', items: ['Brown rice', 'Multigrain roti', 'Oats', 'Millets (bajra, jowar)'] },
    { category: 'Vegetables', items: ['Seasonal vegetables', 'Spinach', 'Tomatoes', 'Carrots', 'Peas'] },
    { category: 'Protein', items: ['Dal', 'Rajma', 'Eggs', 'Paneer (limited)', 'Chicken (grilled)'] },
    { category: 'Fruits & Dairy', items: ['Seasonal fruits', 'Curd', 'Buttermilk', 'Low-fat milk'] },
  ],
  avoid: ['Fried foods (pakoras, samosas)', 'Excess sugar & sweets', 'Processed & packaged snacks', 'Alcohol & smoking', 'Excess salt'],
  tips: [
    'Drink 8-10 glasses of water daily',
    'Eat a rainbow — different coloured vegetables',
    'Walk 30 min a day, 5 days a week',
    'Sleep 7-8 hours — it\'s as important as diet',
  ],
};

export default function DietTab() {
  const profile = loadProfile();
  const conditions = profile?.conditions || [];
  const [activeCondition, setActiveCondition] = useState<string>(conditions[0] || 'general');
  const [showDetails, setShowDetails] = useState<Record<string, boolean>>({});

  const planKeys = conditions.length > 0 ? conditions : ['general'];
  const currentKey = activeCondition === 'general' || !DIET_PLANS[activeCondition] ? 'general' : activeCondition;
  const plan = currentKey === 'general' ? GENERAL_PLAN : DIET_PLANS[currentKey];

  return (
    <div className="px-4 py-4 pb-10 space-y-4">

      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-ink">Diet Chart</h2>
        <p className="text-sm text-ink-3 mt-0.5">
          {conditions.length > 0
            ? `Personalised for your ${conditions.length === 1 ? 'condition' : 'conditions'}`
            : 'General healthy eating guide'}
        </p>
      </div>

      {/* Condition tabs */}
      {planKeys.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {planKeys.map(c => {
            const p = DIET_PLANS[c] || GENERAL_PLAN;
            return (
              <button key={c}
                onClick={() => setActiveCondition(c)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                  activeCondition === c ? `${p.color} ${p.border} ${p.text}` : 'bg-surface border-line text-ink-3'
                }`}>
                <span>{p.icon}</span>
                <span className="whitespace-nowrap">{c === 'general' ? 'General' : c}</span>
              </button>
            );
          })}
          <button onClick={() => setActiveCondition('general')}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
              activeCondition === 'general' ? 'bg-success/8 border-success/20 text-success' : 'bg-surface border-line text-ink-3'
            }`}>
            🥗 <span>General</span>
          </button>
        </div>
      )}

      <motion.div key={activeCondition} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="space-y-4">

        {/* Condition banner */}
        <div className={`${plan.color} border ${plan.border} rounded-2xl px-4 py-3 flex items-center gap-3`}>
          <span className="text-2xl">{plan.icon}</span>
          <div>
            <p className={`font-bold text-sm ${plan.text}`}>{plan.condition}</p>
            <p className="text-xs text-ink-3">Eat right for your health condition</p>
          </div>
        </div>

        {/* Eat this */}
        <div>
          <p className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-2.5">✅ Eat More of These</p>
          <div className="space-y-2">
            {plan.eat.map((cat, i) => (
              <div key={i} className="bg-success/5 border border-success/15 rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowDetails(p => ({ ...p, [cat.category]: !p[cat.category] }))}
                  className="w-full flex items-center justify-between px-3.5 py-3"
                >
                  <p className="text-sm font-semibold text-success">{cat.category}</p>
                  <span className="text-ink-3 text-sm">{showDetails[cat.category] ? '▲' : '▼'}</span>
                </button>
                {(showDetails[cat.category] !== false) && (
                  <div className="px-3.5 pb-3">
                    <div className="flex flex-wrap gap-1.5">
                      {cat.items.map(item => (
                        <span key={item} className="text-2xs bg-success/10 border border-success/20 text-success px-2.5 py-1 rounded-full font-medium">{item}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Avoid this */}
        <div>
          <p className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-2.5">❌ Avoid or Limit</p>
          <div className="bg-danger/5 border border-danger/15 rounded-xl px-3.5 py-3">
            <div className="flex flex-wrap gap-1.5">
              {plan.avoid.map(item => (
                <span key={item} className="text-2xs bg-danger/8 border border-danger/15 text-danger px-2.5 py-1 rounded-full font-medium">{item}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Tips */}
        <div>
          <p className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-2.5">💡 Lifestyle Tips</p>
          <div className="space-y-2">
            {plan.tips.map((tip, i) => (
              <div key={i} className="bg-surface border border-line rounded-xl px-3.5 py-3 flex items-start gap-3">
                <div className="w-6 h-6 bg-primary/10 rounded-full flex items-center justify-center text-xs font-bold text-primary flex-shrink-0 mt-0.5">{i + 1}</div>
                <p className="text-sm text-ink-2 leading-relaxed">{tip}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Disclaimer */}
        <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl px-3.5 py-3">
          <p className="text-xs text-amber-700 leading-relaxed">
            ⚠️ <strong>Disclaimer:</strong> This is a general diet guide. Always consult your doctor or dietitian for a personalised plan based on your exact condition, medications, and test reports.
          </p>
        </div>

      </motion.div>
    </div>
  );
}
