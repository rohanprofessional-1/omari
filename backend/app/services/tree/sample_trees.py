from app.schemas.tree import Tree, VariableNode, BranchNode, BranchCondition, ActionNode, EndNode

knee_pain_tree = Tree(
    root_node_id="v_duration",
    nodes={
        "v_duration": VariableNode(
            id="v_duration",
            label="Pain Duration",
            variable_name="pain_duration",
            valid_values=["<1 week", "1-4 weeks", ">4 weeks"],
            value_definitions={"<1 week": "Acute", "1-4 weeks": "Subacute", ">4 weeks": "Chronic"},
            few_shot_examples=[{"patient": "It's been hurting for a couple days.", "value": "<1 week"}],
            next_node_id="v_level"
        ),
        "v_level": VariableNode(
            id="v_level",
            label="Pain Level",
            variable_name="pain_level",
            valid_values=["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
            value_definitions={"1": "Mild", "10": "Severe"},
            few_shot_examples=[{"patient": "It's extremely painful, like an 8 out of 10.", "value": "8"}],
            next_node_id="v_swelling"
        ),
        "v_swelling": VariableNode(
            id="v_swelling",
            label="Swelling Present",
            variable_name="swelling",
            valid_values=["yes", "no"],
            value_definitions={"yes": "Visible swelling", "no": "No swelling"},
            few_shot_examples=[{"patient": "My knee looks huge.", "value": "yes"}],
            next_node_id="v_popping"
        ),
        "v_popping": VariableNode(
            id="v_popping",
            label="Popping Sound",
            variable_name="popping_sound",
            valid_values=["yes", "no"],
            value_definitions={"yes": "Heard a pop at time of injury", "no": "Did not hear a pop"},
            few_shot_examples=[{"patient": "I heard a loud pop when I landed.", "value": "yes"}],
            next_node_id="v_injury"
        ),
        "v_injury": VariableNode(
            id="v_injury",
            label="Previous Injury",
            variable_name="previous_injury",
            valid_values=["yes", "no"],
            value_definitions={"yes": "Has injured this knee before", "no": "First time injuring this knee"},
            few_shot_examples=[{"patient": "I tore my ACL in this knee 5 years ago.", "value": "yes"}],
            next_node_id="b_evaluate"
        ),
        "b_evaluate": BranchNode(
            id="b_evaluate",
            conditions=[
                BranchCondition(variable_name="pain_level", operator=">=", value=8, next_node_id="a_urgent_xray"),
                BranchCondition(variable_name="swelling", operator="==", value="yes", next_node_id="a_urgent_xray"),
                BranchCondition(variable_name="popping_sound", operator="==", value="yes", next_node_id="a_urgent_xray"),
            ],
            default_next_node_id="a_recommend_rest"
        ),
        "a_urgent_xray": ActionNode(
            id="a_urgent_xray",
            action_type="order_xray",
            payload={"urgency": "high", "body_part": "knee"},
            next_node_id="end_referral"
        ),
        "a_recommend_rest": ActionNode(
            id="a_recommend_rest",
            action_type="recommend_rest",
            payload={"duration": "1-2 weeks", "method": "RICE"},
            next_node_id="end_referral"
        ),
        "end_referral": EndNode(
            id="end_referral"
        )
    }
)
