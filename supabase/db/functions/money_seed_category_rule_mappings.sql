-- Function: money_seed_category_rule_mappings()
-- Repair/seed built-in MCC and source-category canonical mappings.

CREATE OR REPLACE FUNCTION public.money_seed_category_rule_mappings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.money_mcc_canonical_category_map (
    mcc,
    canonical_system_key,
    description
  )
  VALUES
    -- T-Bank pseudo MCCs with stable semantics
    ('0001', 'transfers', 'T-Bank transfers'),
    ('0004', 'utilities', 'T-Bank mobile communication services'),
    ('0014', 'utilities', 'T-Bank internet services'),
    -- transport
    ('4111', 'transport', 'Local and suburban commuter transportation'),
    ('4112', 'transport', 'Passenger railways'),
    ('4121', 'transport', 'Taxicabs and limousines'),
    ('4131', 'transport', 'Bus lines'),
    ('4215', 'services_fees', 'Courier services'),
    ('4784', 'transport', 'Tolls and bridge fees'),
    ('5541', 'transport', 'Service stations'),
    ('5542', 'transport', 'Automated fuel dispensers'),
    ('7523', 'transport', 'Parking lots and garages'),
    -- utilities
    ('4900', 'utilities', 'Utilities'),
    ('4814', 'utilities', 'Telecommunication services'),
    ('4899', 'utilities', 'Cable, satellite, and pay television services'),
    -- food
    ('3991', 'food', 'T-Bank supermarkets'),
    ('5411', 'food', 'Grocery stores and supermarkets'),
    ('5499', 'food', 'Miscellaneous food stores'),
    ('5462', 'food', 'Bakeries'),
    ('5812', 'food', 'Restaurants and eating places'),
    ('5813', 'food', 'Bars and lounges'),
    ('5814', 'food', 'Fast food restaurants'),
    ('5921', 'food', 'Beer, wine, and liquor stores'),
    -- housing
    ('6513', 'housing', 'Real estate agents and managers; rentals'),
    -- health
    ('5912', 'health', 'Drug stores and pharmacies'),
    ('8011', 'health', 'Doctors and physicians'),
    ('8021', 'health', 'Dentists and orthodontists'),
    ('8041', 'health', 'Chiropractors'),
    ('8042', 'health', 'Optometrists and ophthalmologists'),
    ('8043', 'health', 'Opticians and eyeglasses'),
    ('8062', 'health', 'Hospitals'),
    ('8071', 'health', 'Medical and dental laboratories'),
    ('8099', 'health', 'Medical services and health practitioners'),
    ('5975', 'health', 'Hearing aids and supplies'),
    ('5976', 'health', 'Orthopedic goods and prosthetic devices'),
    -- education
    ('8211', 'education', 'Elementary and secondary schools'),
    ('8220', 'education', 'Colleges, universities, and professional schools'),
    ('8241', 'education', 'Correspondence schools'),
    ('8299', 'education', 'Educational services not elsewhere classified'),
    -- entertainment
    ('7832', 'entertainment', 'Motion picture theaters'),
    ('7922', 'entertainment', 'Theatrical producers and ticket agencies'),
    ('7994', 'entertainment', 'Video game arcades'),
    ('7996', 'entertainment', 'Amusement parks, carnivals, and circuses'),
    ('7998', 'entertainment', 'Aquariums, dolphinariums, zoos, and seaquariums'),
    ('7999', 'entertainment', 'Recreation services not elsewhere classified'),
    ('5815', 'entertainment', 'Digital goods: audiobooks, music, and movies'),
    ('5816', 'entertainment', 'Digital goods: games'),
    ('5818', 'entertainment', 'Digital goods and subscriptions'),
    -- travel
    ('4411', 'travel', 'Cruise lines'),
    ('4511', 'travel', 'Airlines and air carriers'),
    ('4582', 'travel', 'Airports and airport terminals'),
    ('4722', 'travel', 'Travel agencies and tour operators'),
    ('4723', 'travel', 'Package tour operators'),
    ('7011', 'travel', 'Hotels, motels, resorts, and lodging'),
    ('7033', 'travel', 'Campgrounds and trailer parks'),
    ('7512', 'travel', 'Automobile rental agencies'),
    -- shopping
    ('5311', 'shopping', 'Department stores'),
    ('5331', 'shopping', 'Variety stores'),
    ('5399', 'shopping', 'Miscellaneous general merchandise stores'),
    ('5651', 'shopping', 'Family clothing stores'),
    ('5661', 'shopping', 'Shoe stores'),
    ('5732', 'shopping', 'Electronics stores'),
    ('5734', 'shopping', 'Computer software stores'),
    ('5931', 'shopping', 'Used merchandise and secondhand stores'),
    ('5941', 'shopping', 'Sporting goods stores'),
    ('5942', 'shopping', 'Book stores'),
    ('5977', 'shopping', 'Cosmetic stores'),
    ('5094', 'shopping', 'Jewelry, watches, clocks, and silverware stores'),
    -- pets
    ('0742', 'pets', 'Veterinary services'),
    ('5995', 'pets', 'Pet shops, pet food, and supplies'),
    -- family
    ('5641', 'family', 'Children and infants wear stores'),
    ('5945', 'family', 'Toy and hobby stores'),
    ('8351', 'family', 'Child care services'),
    -- gifts and donations
    ('5193', 'gifts_donations', 'Florists'),
    ('8398', 'gifts_donations', 'Charitable and social service organizations'),
    ('8661', 'gifts_donations', 'Religious organizations'),
    -- transfers
    ('4829', 'transfers', 'Money transfer'),
    -- savings and investments
    ('6211', 'savings_investments', 'Security brokers and dealers'),
    -- taxes
    ('9311', 'taxes', 'Tax payments')
  ON CONFLICT (mcc) DO UPDATE
  SET
    canonical_system_key = EXCLUDED.canonical_system_key,
    description = EXCLUDED.description,
    canonical_category_id = NULL;

  UPDATE public.money_mcc_canonical_category_map AS mapping
  SET canonical_category_id = canonical.id
  FROM public.money_categories AS canonical
  WHERE canonical.system_key = mapping.canonical_system_key
    AND canonical.category_kind = 'canonical';
END;
$$;

REVOKE ALL ON FUNCTION public.money_seed_category_rule_mappings() FROM PUBLIC;

COMMENT ON FUNCTION public.money_seed_category_rule_mappings() IS
  'Seeds and repairs built-in MCC mappings against the canonical money category taxonomy.';
