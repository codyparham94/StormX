from stormx_etl.zcta import parse_gazetteer

SAMPLE = "GEOID\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG                                                                                                               \n00601\t166836392\t799292\t64.416\t0.309\t18.180555\t-66.749961\n70112\t2797478\t0\t1.080\t0.000\t29.957294\t-90.077004 \nbroken\n"


def test_parse_gazetteer():
    assert parse_gazetteer(SAMPLE) == {"00601": [18.1806, -66.75], "70112": [29.9573, -90.077]}


PIPES = "GEOID|GEOIDFQ|ALAND|AWATER|ALAND_SQMI|AWATER_SQMI|INTPTLAT|INTPTLONG\n00601|860Z200US00601|166744424|795116|64.38|0.307|18.180621|-66.749931\n"


def test_parse_pipe_separated_2026_format():
    assert parse_gazetteer(PIPES) == {"00601": [18.1806, -66.7499]}
